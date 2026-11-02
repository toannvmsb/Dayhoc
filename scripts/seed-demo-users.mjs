// DẠYZI — tạo bộ tài khoản mẫu (2 gia đình + 1 giáo viên) qua chính API của app.
// CHỈ TẠO THÊM, không xoá gì. Chạy lại được (bỏ qua thứ đã có).
//
//   Local (Postgres local + auth dev):
//     DATABASE_URL=postgres://postgres@127.0.0.1:5433/parent_copilot DZ_DEV_AUTH=1 \
//       node scripts/seed-demo-users.mjs --local
//
//   Hosted (Supabase thật; đọc .env: PILOT_DATABASE_URL + SUPABASE_URL/JWT_SECRET/SERVICE_ROLE_KEY):
//     SEED_PASSWORD=... node --env-file=.env scripts/seed-demo-users.mjs --hosted
//
// Mật khẩu lấy từ biến SEED_PASSWORD (tối thiểu 8 ký tự — luật của app, cả adapter dev lẫn Supabase) để
// không nằm trong source. Chỉ dành cho tài khoản thử, đừng dùng cho người dùng thật.
import { Pool } from 'pg';

const mode = process.argv.includes('--hosted') ? 'hosted' : process.argv.includes('--local') ? 'local' : null;
if (!mode) { console.error('Cần --local hoặc --hosted'); process.exit(2); }

const PASSWORD = process.env.SEED_PASSWORD ?? '';
if (PASSWORD.length < 8) { console.error('Cần đặt SEED_PASSWORD (>= 8 ký tự)'); process.exit(2); }
const FAMILIES = [
  { parent: 'Chame1@dayzi.vn', name: 'Cha mẹ 1', kids: [{ username: 'con14', name: 'Con 1 (lớp 4)', grade: 4 }, { username: 'con17', name: 'Con 1 (lớp 7)', grade: 7 }] },
  { parent: 'Chame2@dayzi.vn', name: 'Cha mẹ 2', kids: [{ username: 'con24', name: 'Con 2 (lớp 4)', grade: 4 }, { username: 'con27', name: 'Con 2 (lớp 7)', grade: 7 }] },
];
const TEACHER = { email: 'Giaovien@dayzi.vn', name: 'Giáo viên' };

const env = process.env;
let connectionString;
let ssl;
if (mode === 'hosted') {
  connectionString = env.PILOT_DATABASE_URL;
  if (!connectionString) { console.error('Thiếu PILOT_DATABASE_URL'); process.exit(2); }
  for (const k of ['SUPABASE_URL', 'SUPABASE_JWT_SECRET', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (!env[k]) { console.error(`Thiếu ${k} (cần cho Supabase Auth thật)`); process.exit(2); }
  }
  ssl = { rejectUnauthorized: false };
  const u = new URL(connectionString); u.searchParams.delete('sslmode'); connectionString = u.toString();
} else {
  connectionString = env.DATABASE_URL;
  if (!connectionString || !/@(127\.0\.0\.1|localhost)[:/]/.test(connectionString)) {
    console.error('--local chỉ chạy với DATABASE_URL trỏ localhost'); process.exit(2);
  }
  env.DZ_DEV_AUTH = '1';
  delete env.SUPABASE_URL; delete env.SUPABASE_JWT_SECRET; delete env.SUPABASE_SERVICE_ROLE_KEY;
}

const { createProductionApi } = await import('../services/api/dist/index.js');
const { resolveAuthAdapter } = await import('../packages/identity/dist/index.js');
const { adapter, kind } = resolveAuthAdapter(env);
if (mode === 'hosted' && kind !== 'supabase') { console.error(`Cần adapter supabase, nhận "${kind}"`); process.exit(2); }

const pool = new Pool({ connectionString, ssl, max: 2 });
const api = createProductionApi({ pool, authAdapter: adapter, authKind: kind });

const userByEmail = async (email) =>
  (await pool.query(`SELECT id FROM users WHERE lower(primary_email) = lower($1)`, [email])).rows[0];

async function ensureAccount(email, intendedRole, displayName) {
  if (await userByEmail(email)) return 'đã có';
  await api.register({ email, password: PASSWORD, intendedRole, displayName });
  return 'đã tạo';
}

try {
  console.log(`Chế độ: ${mode} (auth: ${kind})`);
  for (const f of FAMILIES) {
    console.log(`${f.parent}: ${await ensureAccount(f.parent, 'PARENT', f.name)}`);
    const { bearer } = await api.signIn({ email: f.parent, password: PASSWORD });
    const auth = { bearer, workspace: 'PARENT' };
    const me = await userByEmail(f.parent);
    for (const k of f.kids) {
      let childId = (await pool.query(
        `SELECT c.id FROM child_profiles c JOIN parent_child_relationships r ON r.child_id = c.id
          WHERE r.parent_user_id = $1 AND r.status = 'ACTIVE' AND c.deletion_state <> 'deleted' AND c.display_name = $2`,
        [me.id, k.name])).rows[0]?.id;
      if (!childId) {
        try {
          childId = (await api.createChild(auth, { displayName: k.name, schoolGrade: k.grade })).childId;
        } catch (e) {
          if (!/tối đa/.test(String(e.message))) throw e;
          // Gói free chỉ 1 hồ sơ con → cấp gói BASIC thủ công (nguồn 'manual', không thu tiền) rồi thử lại.
          const fam = (await pool.query(
            `SELECT family_id FROM family_memberships WHERE user_id = $1 AND member_role = 'OWNER' LIMIT 1`, [me.id])).rows[0];
          await pool.query(
            `INSERT INTO family_subscriptions (family_id, plan, status, current_period_end, updated_at, source, auto_renew)
             VALUES ($1, 'basic', 'active', now() + interval '365 days', now(), 'manual', false)
             ON CONFLICT (family_id) DO UPDATE SET plan = 'basic', status = 'active'`, [fam.family_id]);
          childId = (await api.createChild(auth, { displayName: k.name, schoolGrade: k.grade })).childId;
        }
      }
      const s = await api.createStudentAccess(auth, childId, { username: k.username, displayName: k.name, password: PASSWORD });
      console.log(`  bé ${k.name}: đăng nhập "${k.username}" — ${s.alreadyExists ? 'đã có' : 'đã tạo'}`);
    }
  }
  console.log(`${TEACHER.email}: ${await ensureAccount(TEACHER.email, 'TEACHER', TEACHER.name)}`);
} finally {
  await pool.end();
}
