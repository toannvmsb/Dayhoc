/* eslint-disable no-undef */
/**
 * Build step: Dev Core v1.0 YAML  →  normalized KB JSON.
 *
 * Reads packages/math-data/data/dev-core/{grade4,grade7}/*.yaml plus the
 * hand-maintained cross-grade bridges, applies derivation rules, and emits
 * src/data/grade4.json + src/data/grade7.json in the loader's schema.
 *
 * Run:  node packages/math-data/scripts/build-kb.mjs
 * (committed output — no yaml dependency at runtime).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import YAML from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEV = join(ROOT, 'data', 'dev-core');
const OUT = join(ROOT, 'src', 'data');

/**
 * Human-readable revision tag for the curriculum / skill-graph SEMANTICS.
 * Bump when the meaning changes (new chapters, re-scoped skills, DAG rewrites).
 * The loader also computes a content hash, so an accidental data edit is still
 * detectable even without bumping this.
 */
const DATASET_REVISION = 'math-dev-core-1.0';

const readYaml = (p) => YAML.parse(readFileSync(p, 'utf8'));

/** dev-core domain slug → the loader's Domain enum (coarser, stable). */
const DOMAIN_MAP = {
  number_sense: 'number_sense',
  arithmetic: 'arithmetic',
  algebraic_thinking: 'algebraic_thinking',
  word_problems: 'word_problems',
  fractions: 'fractions',
  geometry: 'geometry',
  measurement: 'measurement',
  statistics_probability: 'statistics_probability',
  pattern_reasoning: 'pattern_reasoning',
  logical_reasoning: 'logical_reasoning',
  combinatorial_thinking: 'combinatorial_thinking',
  // grade 7 domains
  rational_numbers: 'arithmetic',
  real_numbers: 'number_sense',
  angles_parallel_lines: 'geometry',
  congruent_triangles: 'geometry',
  triangle_relationships: 'geometry',
  practical_solids: 'geometry',
  proof_reasoning: 'logical_reasoning',
  data_representation: 'statistics_probability',
  probability: 'statistics_probability',
  ratios_proportions: 'algebraic_thinking',
  algebra_polynomials: 'algebraic_thinking',
};

/**
 * grade7/problem_types.yaml `families:` slugs double as the `id` suffix
 * (`M7.PT.<FAMILY>.<SLUG>`) AND, until now, the raw `name` shown to parents —
 * so the "Dạng bài" (problem type) axis on Progress showed English snake_case
 * like `direct_sum_difference`/`fraction_rational_operations` (D-24/D-30).
 * The `id` must stay the stable English slug (it's referenced as free-text
 * `problem_type_id` on evidence — see CLAUDE.md); only the display `name`
 * is translated here, by lookup, so nothing that stores/matches on the id
 * is affected. A slug missing from this map falls back to itself so a new
 * slug never crashes the build — it just needs a translation added.
 */
const G7_PROBLEM_TYPE_NAME_VN = {
  fraction_rational_operations: 'Phép tính với số hữu tỉ',
  fast_calculation_by_structure: 'Tính nhanh theo cấu trúc biểu thức',
  powers_zero_exponent: 'Lũy thừa với số mũ 0',
  sign_rules: 'Quy tắc dấu',
  nested_rational_expressions: 'Biểu thức hữu tỉ lồng nhau',
  one_step_rational_equation: 'Phương trình hữu tỉ một bước',
  multi_step_linear_equation: 'Phương trình bậc nhất nhiều bước',
  distributive_equation: 'Phương trình dùng tính chất phân phối',
  rational_expression_equation: 'Phương trình chứa biểu thức hữu tỉ',
  square_or_quadratic_structure: 'Cấu trúc bình phương / bậc hai',
  equation_in_ratio_or_system: 'Phương trình trong tỉ lệ thức / hệ phương trình',
  direct_ratio: 'Tỉ lệ thuận trực tiếp',
  equal_ratio: 'Dãy tỉ số bằng nhau',
  chained_ratio: 'Tỉ số liên hoàn',
  ratio_linear_constraint: 'Tỉ lệ thức có ràng buộc bậc nhất',
  ratio_product_constraint: 'Tỉ lệ thức có ràng buộc về tích',
  ratio_quadratic_constraint: 'Tỉ lệ thức có ràng buộc bậc hai',
  transformed_denominators: 'Biến đổi mẫu số',
  multivariable_nonlinear_reasoning: 'Suy luận phi tuyến nhiều biến',
  equal_ratio_xyz: 'Dãy tỉ số bằng nhau với x, y, z',
  multiple_chained_ratios: 'Nhiều tỉ số liên hoàn',
  ratio_linear_equation: 'Tỉ lệ thức kết hợp phương trình bậc nhất',
  ratio_xyz_constraint: 'Ràng buộc tỉ lệ giữa x, y, z',
  ratio_quadratic_form: 'Tỉ lệ thức dạng bậc hai',
  shifted_variable_ratio: 'Tỉ lệ thức khi biến bị dịch chuyển',
  rational_denominator_systems: 'Hệ phương trình với mẫu số hữu tỉ',
  distributive_property: 'Tính chất phân phối',
  polynomial_expansion: 'Khai triển đa thức',
  common_factor_extraction: 'Đặt nhân tử chung',
  algebraic_identity: 'Hằng đẳng thức đáng nhớ',
  symmetric_expression: 'Biểu thức đối xứng',
  factorization: 'Phân tích đa thức thành nhân tử',
  conditional_simplification: 'Rút gọn có điều kiện',
  proof: 'Chứng minh',
  nonlinear_system_HSG: 'Hệ phi tuyến (nâng cao)',
  derive_from_sum_product: 'Suy ra từ tổng và tích',
  x_plus_inverse_x: 'Biểu thức x + 1/x',
  ab_bc_ca_condition: 'Điều kiện ab + bc + ca',
  cyclic_symmetric_rational: 'Biểu thức hữu tỉ đối xứng vòng quanh',
  sum_zero_identity: 'Hằng đẳng thức khi tổng bằng 0',
  common_factor: 'Nhân tử chung',
  grouping: 'Nhóm hạng tử',
  identities: 'Dùng hằng đẳng thức',
  cyclic_symmetric: 'Đối xứng vòng quanh',
  under_condition: 'Phân tích có điều kiện',
  identity_proof: 'Chứng minh đẳng thức',
  derive_invariant: 'Suy ra đại lượng không đổi',
  inequality_sign_reasoning: 'Suy luận dấu của bất đẳng thức',
  integer_perfect_power: 'Số nguyên là lũy thừa đúng',
  HSG_transformation: 'Biến đổi nâng cao (HSG)',
  angles_parallel_lines: 'Góc tạo bởi đường thẳng song song',
  congruent_triangles: 'Tam giác bằng nhau',
  midpoint_ray_segment: 'Trung điểm, tia, đoạn thẳng',
  triangle_relationships: 'Quan hệ giữa các yếu tố trong tam giác',
  practical_solids: 'Hình khối trong thực tế',
  choose_two_endpoints: 'Chọn hai đầu mút',
  systematic_counting: 'Đếm có hệ thống',
};

/** curriculum_origin string → numeric grade (curriculumOrigin). */
function originToGrade(origin, gradeContext) {
  if (!origin) return gradeContext;
  const s = String(origin).toUpperCase();
  if (s.includes('G9') || s.includes('HSG') || s.includes('COMPETITION')) return 9;
  if (s.includes('G8')) return 8;
  if (s.includes('ABOVE')) return gradeContext + 1;
  const m = s.match(/G(\d)/);
  return m ? Number(m[1]) : gradeContext;
}

/** thinking_level → derived knowledge_level when the source omits it. */
function deriveKnowledge(curriculumOriginGrade, gradeContext, thinkingLevel) {
  if (curriculumOriginGrade > gradeContext) return curriculumOriginGrade >= 9 ? 'K5' : 'K4';
  if (thinkingLevel === 'T5') return 'K3';
  return 'K2';
}

/** domain → the thinking dimensions a skill in that domain typically exercises. */
const DIMENSIONS_BY_DOMAIN = {
  number_sense: ['number_sense', 'pattern_recognition'],
  arithmetic: ['number_sense', 'strategic_choice'],
  algebraic_thinking: ['algebraic_thinking', 'problem_representation', 'strategic_choice'],
  word_problems: ['problem_representation', 'strategic_choice', 'reverse_reasoning'],
  fractions: ['number_sense', 'strategic_choice'],
  geometry: ['spatial_reasoning', 'proof_explanation', 'pattern_recognition'],
  measurement: ['number_sense', 'problem_representation'],
  statistics_probability: ['problem_representation', 'logical_reasoning'],
  logical_reasoning: ['logical_reasoning', 'proof_explanation', 'reverse_reasoning'],
  pattern_reasoning: ['pattern_recognition', 'number_sense'],
  combinatorial_thinking: ['combinatorial_thinking', 'logical_reasoning'],
};

/**
 * Above-grade Grade 7 skill families (from Math Core "Biến đổi đồng nhất" +
 * cross-grade paths). Real skills carrying G8/G9/HSG exposure. Reviewed against
 * SGK Toán 7 KNTT in the P-01 review, approved by anh 2026-09-01
 * (docs/implementation/M7_SKILL_REVIEW.md §4).
 */
const ADVANCED_G7 = [
  { id: 'M7.RATIO.MULTIVAR', name: 'Hệ tỉ số nhiều biến (x/a=y/b=z/c, điều kiện tích/bậc hai)', domain: 'algebraic_thinking', origin: 8, prereq: 'M7.RATIO.EQUAL_CHAIN' },
  { id: 'M7.ALG.IDENTITY', name: 'Biến đổi đồng nhất và hằng đẳng thức', domain: 'algebraic_thinking', origin: 8, prereq: 'M7.ALG.POLY_MUL' },
  { id: 'M7.ALG.SYMMETRIC', name: 'Biểu thức đối xứng từ a+b và ab (HSG)', domain: 'algebraic_thinking', origin: 9, prereq: 'M7.ALG.IDENTITY' },
  { id: 'M7.ALG.FACTOR', name: 'Phân tích thành nhân tử nâng cao', domain: 'algebraic_thinking', origin: 8, prereq: 'M7.ALG.IDENTITY' },
  { id: 'M7.PROOF.ALGEBRA', name: 'Chứng minh đại số / bất đẳng thức (HSG)', domain: 'logical_reasoning', origin: 9, prereq: 'M7.ALG.SYMMETRIC' },
];

function buildGrade(gradeContext) {
  const g = `grade${gradeContext}`;
  const skillGraph = readYaml(join(DEV, g, 'skill_graph.yaml'));
  const curriculumSrc = readYaml(join(DEV, g, 'curriculum.yaml'));
  const prereqSrc = readYaml(join(DEV, g, 'prerequisite_graph.yaml'));
  const ptSrc = readYaml(join(DEV, g, 'problem_types.yaml'));

  // --- curriculum nodes + skill → node reverse index ---
  const curriculum = [];
  const skillToNode = new Map();
  const groups = curriculumSrc.themes ?? curriculumSrc.chapters ?? [];
  groups.forEach((grp, gi) => {
    const items = grp.items ?? grp.lessons ?? [];
    const strand = `${grp.theme_name ?? grp.chapter_name ?? `Nhóm ${gi + 1}`}`;
    items.forEach((it, ii) => {
      const id = `C.G${gradeContext}.${grp.theme_id ?? grp.chapter_id ?? gi + 1}.${it.lesson_number ?? ii + 1}`;
      curriculum.push({
        id,
        gradeContext,
        // real SGK lesson nodes are CORE_CURRICULUM: the school teaches these, so
        // only they may become the resolved current lesson (doc 13 C4.2 §1).
        nodeType: 'CORE_CURRICULUM',
        textbook: curriculumSrc.textbook ?? 'Kết nối tri thức với cuộc sống',
        ...(grp.volume ? { volume: grp.volume } : {}),
        strand,
        lesson: it.title,
      });
      for (const sid of it.skill_ids ?? []) {
        if (!skillToNode.has(sid)) skillToNode.set(sid, id);
      }
    });
  });
  // a fallback node for skills the curriculum doesn't atomically list (advanced /
  // HSG / enrichment families). ADVANCED: NOT a school-teaching node — it must
  // never become the resolved current lesson (doc 13 C4.2 §1).
  const fallbackNodeId = `C.G${gradeContext}.EXT.0`;
  curriculum.push({
    id: fallbackNodeId,
    gradeContext,
    nodeType: 'ADVANCED',
    textbook: 'Math Core (skill family)',
    strand: 'Nội dung theo skill family / nâng cao',
    lesson: 'Không ứng với một bài SGK đơn lẻ',
  });

  // --- skills ---
  const skills = [];
  const skillIds = new Set(Object.keys(skillGraph.skills));
  for (const [id, s] of Object.entries(skillGraph.skills)) {
    const domain = DOMAIN_MAP[s.domain] ?? 'logical_reasoning';
    const curriculumOrigin = originToGrade(s.curriculum_origin, gradeContext);
    skills.push({
      id,
      gradeContext,
      domain,
      topic: s.name,
      name: s.name,
      description: '',
      curriculumNodeId: skillToNode.get(id) ?? fallbackNodeId,
      curriculumOrigin,
      thinkingDimensions: DIMENSIONS_BY_DOMAIN[domain] ?? ['logical_reasoning'],
      advancedExtensions: [],
    });
  }
  // synthetic above-grade Grade 7 skills
  if (gradeContext === 7) {
    for (const a of ADVANCED_G7) {
      skillIds.add(a.id);
      skills.push({
        id: a.id,
        gradeContext: 7,
        domain: a.domain,
        topic: a.name,
        name: a.name,
        description: 'Above-grade / HSG exposure family (P-01 educator-reviewed 2026-09-01).',
        curriculumNodeId: fallbackNodeId,
        curriculumOrigin: a.origin,
        thinkingDimensions: DIMENSIONS_BY_DOMAIN[a.domain] ?? ['algebraic_thinking'],
        advancedExtensions: [],
      });
    }
  }

  // --- prerequisites ---
  const gradeOf = (sid) => (sid.startsWith('M4.') ? 4 : sid.startsWith('M7.') ? 7 : gradeContext);
  const prerequisites = [];
  const edgeList = prereqSrc.edges ?? prereqSrc.standard_curriculum_edges ?? [];
  for (const e of edgeList) {
    if (!skillIds.has(e.from) || !skillIds.has(e.to)) continue;
    prerequisites.push({
      from: e.from,
      to: e.to,
      importance: e.importance ?? 0.8,
      crossGrade: gradeOf(e.from) !== gradeOf(e.to),
    });
  }
  // hand-maintained cross-grade bridges land in the grade-7 dataset (from = M4 skill).
  if (gradeContext === 7) {
    const bridges = readYaml(join(ROOT, 'data', 'bridges.yaml'));
    for (const e of bridges.edges ?? []) {
      prerequisites.push({ from: e.from, to: e.to, importance: e.importance ?? 0.75, crossGrade: true });
    }
    for (const a of ADVANCED_G7) {
      if (skillIds.has(a.prereq)) {
        prerequisites.push({ from: a.prereq, to: a.id, importance: 0.85, crossGrade: false });
      }
    }
  }

  // --- problem types ---
  const problemTypes = [];
  if (ptSrc.problem_type_families) {
    // grade 4: structured {id, name, thinking_level}
    for (const [skillId, list] of Object.entries(ptSrc.problem_type_families)) {
      if (!skillIds.has(skillId)) continue;
      const origin = originToGrade(skillGraph.skills[skillId]?.curriculum_origin, gradeContext);
      for (const pt of list) {
        problemTypes.push({
          id: pt.id,
          skillId,
          name: pt.name,
          knowledgeLevel: deriveKnowledge(origin, gradeContext, pt.thinking_level),
          thinkingLevel: pt.thinking_level ?? 'T2',
        });
      }
    }
  }
  if (ptSrc.families) {
    // grade 7: family -> [slug]. Map family to the first matching M7 skill by prefix/keyword.
    const familyToSkill = pickFamilySkills(ptSrc.families, skillIds, skillGraph.skills);
    const originOf = new Map(skills.map((s) => [s.id, s.curriculumOrigin]));
    const T_BY_INDEX = ['T2', 'T2', 'T3', 'T3', 'T4', 'T4', 'T5', 'T5', 'T5'];
    for (const [family, slugs] of Object.entries(ptSrc.families)) {
      const skillId = familyToSkill[family];
      if (!skillId) continue;
      const origin = originOf.get(skillId) ?? gradeContext;
      slugs.forEach((slug, i) => {
        const thinkingLevel = T_BY_INDEX[Math.min(i, T_BY_INDEX.length - 1)];
        problemTypes.push({
          id: `M7.PT.${family.replace(/^G7\./, '').replace(/\./g, '_')}.${slug.toUpperCase()}`,
          skillId,
          name: G7_PROBLEM_TYPE_NAME_VN[slug] ?? slug,
          knowledgeLevel: deriveKnowledge(origin, gradeContext, thinkingLevel),
          thinkingLevel,
        });
      });
    }
  }

  return {
    gradeContext,
    meta: { datasetRevision: DATASET_REVISION, source: 'math-dev-core' },
    curriculum,
    skills,
    prerequisites,
    problemTypes,
  };
}

/** Best-effort family → representative skill mapping for grade 7 problem-type families. */
function pickFamilySkills(families, skillIds, skills) {
  const has = (id) => skillIds.has(id);
  const map = {};
  const pref = {
    'G7.RAT': ['M7.QNUM.OPERATIONS', 'M7.QNUM.SET'],
    'G7.EQ': ['M7.QNUM.ORDER_TRANSPOSE', 'M7.ALG.EXPRESSION'],
    'G7.RATIO': ['M7.RATIO.EQUAL_CHAIN', 'M7.RATIO.PROPORTION'],
    'G7.MULTIVAR': ['M7.RATIO.MULTIVAR', 'M7.RATIO.EQUAL_CHAIN'],
    'G7.ALG.IDENTITY': ['M7.ALG.IDENTITY', 'M7.ALG.POLY_MUL'],
    'G7.SYM': ['M7.ALG.SYMMETRIC', 'M7.ALG.POLY_MUL'],
    'G7.FACTOR': ['M7.ALG.FACTOR', 'M7.ALG.POLY_MUL'],
    'G7.PROOF': ['M7.PROOF.ALGEBRA', 'M7.GEO.THEOREM_PROOF'],
    'G7.GEO': ['M7.GEO.PARALLEL_CRITERIA', 'M7.TRI.CONGRUENCE_1'],
    'G7.COMB': ['M7.TRI.CONGRUENCE_1'],
  };
  for (const family of Object.keys(families)) {
    const cands = pref[family] ?? [];
    map[family] = cands.find(has) ?? [...skillIds][0];
  }
  void skills;
  return map;
}

for (const grade of [4, 7]) {
  const data = buildGrade(grade);
  const path = join(OUT, `grade${grade}.json`);
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
  console.log(
    `grade${grade}: ${data.skills.length} skills, ${data.curriculum.length} nodes, ` +
      `${data.prerequisites.length} prereq edges, ${data.problemTypes.length} problem types → ${path}`,
  );
}

// --- curriculum calendars (Pricing v1.1 §2 — Curriculum Clock) ---
{
  const CAL = join(ROOT, 'data', 'calendars');
  const files = ['g4-2026-2027.yaml', 'g7-2026-2027.yaml'];
  const calendars = files.map((f) => YAML.parse(readFileSync(join(CAL, f), 'utf8')));
  const path = join(OUT, 'calendars.json');
  writeFileSync(path, JSON.stringify(calendars, null, 2) + '\n');
  console.log(`calendars: ${calendars.length} → ${path}`);
}
