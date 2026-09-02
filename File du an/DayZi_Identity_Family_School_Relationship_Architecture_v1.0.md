# DạyZi --- Identity, Family, School, Classroom & Learning Relationship Architecture

**Product + Technical Specification v1.0 --- Claude Implementation
Input**

## 0. Mục tiêu và phạm vi khóa

Tài liệu này khóa mô hình người dùng, quan hệ gia đình--học sinh--giáo
viên, trường/lớp/năm học, quyền chia sẻ dữ liệu, vòng đời enrollment và
database cho DạyZi.

Các nguyên tắc bắt buộc:

1.  **Child ≠ User.** Hồ sơ học sinh tồn tại độc lập với tài khoản đăng
    nhập của học sinh.
2.  **Một User có thể có nhiều Role**: PARENT, STUDENT, TEACHER.
    UX/workspace độc lập nhưng dùng chung Identity/Auth.
3.  **Parent và Teacher đều có thể chủ động tạo lời mời kết nối.** Nếu
    Teacher chủ động gắn với Parent/Child, **Parent phải ACCEPT** trước
    khi quan hệ có hiệu lực.
4.  **Teacher--Child, Teacher--Parent, Teacher--Class, Teacher--School
    là các relationship độc lập.**
5.  **Relationship ≠ full data sharing.** Mọi quyền đều theo
    scope/permission.
6.  **Class membership ≠ Learning Twin sharing.**
7.  **Không sửa đè lịch sử trường/lớp.** Mỗi năm học tạo enrollment mới.
8.  **Learning Twin đi theo child_id**, xuyên suốt việc đổi lớp, đổi
    trường, đổi tài khoản.
9.  **School/Class/Teacher data là Learning Context evidence**, không
    phải nguồn sự thật tuyệt đối; vẫn đi qua Resolver + provenance.
10. Database chính thức cho MVP: **PostgreSQL (ưu tiên Supabase
    Postgres)**; file/ảnh/PDF dùng private object storage.

------------------------------------------------------------------------

# 1. User & Authentication Model

## 1.1 Ba trải nghiệm người dùng

### Parent Workspace

-   tạo/quản lý Child Profile;
-   liên kết hoặc tách trường/lớp;
-   mời giáo viên;
-   chấp thuận/từ chối yêu cầu kết nối do giáo viên gửi;
-   quản lý quyền giáo viên;
-   upload bài tập/bài kiểm tra;
-   xem Learning Twin, Gap, Frontier, tiến độ;
-   nhận "Hôm nay dạy con gì?";
-   giao bài và xem kết quả;
-   quản lý mục tiêu học;
-   quản lý privacy/consent.

### Student Workspace

-   đăng nhập độc lập nếu đã có Student Account;
-   link vào Child Profile đã tồn tại;
-   xem bài hôm nay, ôn tập, challenge;
-   làm bài, dùng hint, nhận feedback;
-   tham gia classroom khi policy cho phép;
-   không mặc định thấy parent-only analytics.

### Teacher Workspace

-   hồ sơ giáo viên độc lập;
-   gắn với School / Academic Year / Classroom / Subject;
-   có thể chủ động gửi request kết nối Parent/Child;
-   nhận request do Parent gửi;
-   sau khi được Parent approve: nhập lesson progress, homework, test,
    exam scope, observation, assignment... theo permission;
-   chỉ xem dữ liệu Child trong scope được phép.

## 1.2 Identity architecture

``` text
auth_users
    |
    v
users
    |
    +-- user_roles (PARENT / STUDENT / TEACHER)
    |
    +-- parent_profiles
    +-- teacher_profiles
    +-- student_account_links --> children
```

Một email/phone có thể có nhiều role. Khi user có nhiều role, app cho
chọn workspace sau login.

## 1.3 Child Profile không yêu cầu Student Account

``` text
Parent creates Child Profile
        |
        +--> child_id exists immediately
        |
        +--> Student Account optional later
                    |
                    v
             student_account_links
```

Không tạo Child mới khi học sinh đăng ký tài khoản nếu đã có Child
Profile phù hợp.

------------------------------------------------------------------------

# 2. Family Model

Các entity:

``` text
families
family_memberships
children
parent_child_relationships
student_account_links
consent_records
privacy_preferences
```

`parent_child_relationships` nên chứa: - parent_user_id - child_id -
relationship_type: FATHER / MOTHER / GUARDIAN / OTHER - legal_guardian
boolean - status - valid_from / valid_until - created_at

Một Child có thể có nhiều Parent/Guardian. Các hành động privacy quan
trọng phải xác định rõ ai có quyền consent.

------------------------------------------------------------------------

# 3. School, Academic Year, Classroom

## 3.1 School

Không định danh trường chỉ bằng tên. Tối thiểu:

``` text
schools
- id
- official_name
- short_name
- school_type
- official_school_code nullable
- province
- district
- ward
- address
- latitude nullable
- longitude nullable
- verification_status
- created_by
- created_at
```

`verification_status`: UNVERIFIED / COMMUNITY_VERIFIED /
SYSTEM_VERIFIED.

## 3.2 Academic Year

``` text
academic_years
- id
- label                 # 2026-2027
- start_date
- end_date
- region nullable
- status
```

## 3.3 Classroom

Classroom phải version theo năm học:

``` text
classrooms
- id
- school_id
- academic_year_id
- grade
- class_name             # 7C0
- display_name
- cohort_id nullable
- verification_status
- status
- created_by
- created_at
- archived_at nullable
```

`7C0/2026-2027` và `8C0/2027-2028` là hai classroom_id khác nhau.

## 3.4 Class Cohort --- optional

``` text
class_cohorts
- id
- school_id
- cohort_label
```

Dùng để gợi ý một nhóm học sinh đi cùng nhau qua các năm, nhưng **không
coi tên lớp là identity**.

------------------------------------------------------------------------

# 4. Enrollment Model

## 4.1 Student School Enrollment

``` text
student_school_enrollments
- id
- child_id
- school_id
- academic_year_id
- grade
- status
- start_date
- end_date nullable
- source
- verification_status
- created_at
```

Status: PROPOSED / ACTIVE / COMPLETED / TRANSFERRED / WITHDRAWN /
REPEATED.

## 4.2 Student Class Enrollment

``` text
student_class_enrollments
- id
- child_id
- classroom_id
- academic_year_id
- status
- joined_at
- left_at nullable
- source              # PARENT / TEACHER / SCHOOL / SYSTEM_SUGGESTED
- verified_by nullable
- verified_at nullable
```

## 4.3 Privacy modes khi tham gia lớp

``` text
PRIVATE_LEARNING
LINKED_PRIVATE
LINKED_SHARED
```

-   `PRIVATE_LEARNING`: không nhận/chia sẻ dữ liệu lớp.
-   `LINKED_PRIVATE`: nhận Learning Context chung của lớp nhưng không
    chia Learning Twin cá nhân cho giáo viên.
-   `LINKED_SHARED`: nhận dữ liệu lớp và chia một phần dữ liệu theo
    explicit permissions.

------------------------------------------------------------------------

# 5. Teacher Relationships --- hai chiều, Parent approval bắt buộc

Đây là bổ sung quan trọng: **không chỉ Parent mời Teacher; Teacher cũng
có thể chủ động gửi request gắn với Parent và/hoặc Child.**

## 5.1 Nguyên tắc

### Parent-initiated

``` text
Parent -> chọn Child -> tìm Teacher -> chọn Subject/Relationship/Permissions
       -> SEND REQUEST
Teacher -> ACCEPT / REJECT
```

### Teacher-initiated

``` text
Teacher -> tìm/nhập Parent hoặc Child theo cơ chế an toàn
        -> SEND CONNECTION REQUEST
Parent  -> ACCEPT / REJECT
```

**Teacher-initiated request tuyệt đối không tạo quyền truy cập trước khi
Parent ACCEPT.**

Nếu request liên quan Child, Parent/Legal Guardian là approval
authority.

## 5.2 Teacher--Child Link

``` text
teacher_child_links
- id
- teacher_user_id
- child_id
- subject_id nullable
- relationship_type
- initiated_by_role        # PARENT / TEACHER
- initiated_by_user_id
- status
- permission_set_id
- valid_from nullable
- valid_until nullable
- accepted_by_parent_user_id nullable
- accepted_at nullable
- rejected_at nullable
- revoked_at nullable
- created_at
```

Relationship type: - CLASS_TEACHER - SUBJECT_TEACHER - PRIVATE_TUTOR -
COACH - MENTOR - OTHER

Status: - PENDING - ACCEPTED - REJECTED - REVOKED - EXPIRED

## 5.3 Teacher--Parent Link

``` text
teacher_parent_links
- id
- teacher_user_id
- parent_user_id
- child_id nullable
- subject_id nullable
- initiated_by_role
- initiated_by_user_id
- status
- permission_set_id
- accepted_by_user_id nullable
- accepted_at nullable
- revoked_at nullable
- created_at
```

Teacher--Parent không được suy ra tự động từ Teacher--Child.

## 5.4 Teacher--Class và Teacher--School

``` text
teacher_school_memberships
teacher_class_assignments
```

`teacher_class_assignments` phải có: - teacher_user_id - classroom_id -
subject_id - role - academic_year_id - status - verification_status

Một Teacher có thể dạy nhiều lớp/môn/trường.

## 5.5 Connection Request abstraction

Nên có entity chung để audit workflow:

``` text
relationship_requests
- id
- requester_user_id
- requester_role
- target_type            # PARENT / CHILD / TEACHER
- target_user_id nullable
- target_child_id nullable
- relationship_type
- subject_id nullable
- proposed_permissions jsonb
- message nullable
- status
- expires_at nullable
- responded_by_user_id nullable
- responded_at nullable
- created_at
```

Khi ACCEPT mới tạo/activate relationship tương ứng.

------------------------------------------------------------------------

# 6. Permission Model

Không dùng một boolean `teacher_can_view_child`.

Nên dùng scoped permissions:

``` text
VIEW_CLASS_CONTEXT
SUBMIT_CURRENT_LESSON
SUBMIT_CURRICULUM_PROGRESS
SUBMIT_HOMEWORK
SUBMIT_TEST_RESULT
SUBMIT_EXAM_NOTICE
SUBMIT_EXAM_SCOPE
SUBMIT_SKILL_ASSESSMENT
SUBMIT_LEARNING_OBSERVATION
CREATE_ASSIGNMENT
VIEW_ASSIGNMENT_COMPLETION
VIEW_SELECTED_MASTERY
VIEW_SELECTED_GAPS
VIEW_LEARNING_TWIN_SUMMARY
MESSAGE_PARENT
```

Các permission nhạy cảm như `VIEW_SELECTED_GAPS`,
`VIEW_LEARNING_TWIN_SUMMARY` mặc định OFF trừ khi Parent cho phép.

Teacher access có thể đến từ: - CLASS_ASSIGNMENT - PARENT_DIRECT -
SCHOOL_AUTHORIZATION (future)

Quyền cuối cùng = union của grants **nhưng luôn bị privacy/consent
policy chặn ở tầng cao hơn**.

------------------------------------------------------------------------

# 7. Teacher Learning Contribution

Teacher không update Twin trực tiếp.

``` text
Teacher input
    -> TeacherLearningContribution
    -> Learning Evidence
    -> Resolver / Gap Engine / Twin
```

Entity:

``` text
teacher_learning_contributions
- id
- teacher_user_id
- child_id
- subject_id
- relationship_source_type
- relationship_source_id
- contribution_type
- payload jsonb
- observed_at
- created_at
- confidence
- visibility
- attachment_id nullable
```

Types: - CURRENT_LESSON - CURRICULUM_PROGRESS - HOMEWORK - TEST_RESULT -
EXAM_NOTICE - EXAM_SCOPE - SKILL_ASSESSMENT - LEARNING_OBSERVATION -
STRENGTH - WEAKNESS - BEHAVIOUR_OBSERVATION - ASSIGNMENT - COMMENT

Teacher contribution là evidence có provenance, không phải absolute
truth.

------------------------------------------------------------------------

# 8. Academic Progression Engine

## 8.1 Không sửa enrollment cũ

Cuối năm:

``` text
ACTIVE enrollment 2026-2027 Grade 7
    -> COMPLETED
    -> create PROPOSED transition
    -> create proposed 2027-2028 Grade 8 enrollment
```

## 8.2 Enrollment Transition

``` text
enrollment_transitions
- id
- child_id
- from_school_id
- from_classroom_id nullable
- from_academic_year_id
- from_grade
- to_school_id nullable
- to_classroom_id nullable
- to_academic_year_id
- to_grade
- suggested_class_name nullable
- transition_type
- status
- proposed_by
- confirmed_by nullable
- created_at
- confirmed_at nullable
```

Transition types: - PROMOTION - CLASS_CHANGE - SCHOOL_TRANSFER -
REPEAT_GRADE - MANUAL_CORRECTION - GRADUATION

Status: - PROPOSED - CONFIRMED - CANCELLED

## 8.3 Auto progression

Ví dụ:

``` text
2026-2027: School A / 7C0
       |
       v
SYSTEM PROPOSAL
2027-2028: School A / Grade 8 / suggested "8C0"
```

-   Grade có thể auto-propose +1.
-   Tên lớp chỉ là suggestion.
-   Parent hoặc Teacher có thể đề xuất sửa class name, nhưng
    Parent/authorized guardian xác nhận khi liên quan hồ sơ Child.
-   Nếu đổi trường, tạo enrollment mới; không sửa lịch sử.

## 8.4 Transition boundaries

Không assume same-school ở: - Grade 5 -\> 6 - Grade 9 -\> 10

Các boundary này phải yêu cầu xác nhận/chọn trường mới hoặc giữ trạng
thái PROPOSED.

------------------------------------------------------------------------

# 9. Subject Model

``` text
subjects
- id
- code
- name
```

MVP có `MATH`, nhưng architecture phải cho phép: VIETNAMESE / ENGLISH /
SCIENCE / ...

Learning context và teacher permissions phải subject-scoped:

``` text
child + subject + curriculum + academic context
```

------------------------------------------------------------------------

# 10. Learning Data & Database

## 10.1 Database chính thức

**PostgreSQL / Supabase Postgres** cho: - identity/application user
records; - family/child; - school/class/enrollment; -
relationships/permissions; - curriculum/context; - Twin/gaps/plans; -
generation specs; - generated exercise sets; -
assignments/attempts/evidence; - AI cost/telemetry.

Auth có thể dùng Supabase Auth hoặc provider tương đương, nhưng domain
`users` và roles không được phụ thuộc chặt vào vendor.

## 10.2 Object storage

Private object storage cho: - homework images; - test scans; - notebook
images; - PDFs; - teacher attachments.

DB chỉ lưu metadata/path, không lưu binary trực tiếp.

## 10.3 Exercise lifecycle

``` text
Learning Context
 -> Learning Twin
 -> Gap / Frontier / Goal
 -> Learning Plan
 -> ExerciseGenerationSpec
 -> AI Generator
 -> Validator
 -> generated_exercise_sets
 -> assignments
 -> assignment_items
 -> attempts
 -> attempt_answers
 -> learning_evidence
 -> Twin update
```

Các bảng cốt lõi:

``` text
generation_specs
generated_exercise_sets
assignments
assignment_items
attempts
attempt_answers
learning_evidence
mastery_state
thinking_state
gaps
gap_prescriptions
learning_plans
plan_items
```

------------------------------------------------------------------------

# 11. Recommended Core Tables

``` text
auth/provider layer
  auth_users

identity
  users
  user_roles
  parent_profiles
  teacher_profiles
  student_account_links

family
  families
  family_memberships
  children
  parent_child_relationships
  consent_records
  privacy_preferences

education directory
  schools
  academic_years
  subjects
  classrooms
  class_cohorts

membership/enrollment
  teacher_school_memberships
  teacher_class_assignments
  student_school_enrollments
  student_class_enrollments
  enrollment_transitions

relationships
  relationship_requests
  teacher_child_links
  teacher_parent_links
  permission_sets
  permission_grants

learning
  teacher_learning_contributions
  learning_context_events
  learning_context_snapshots
  evidence
  mastery_state
  thinking_state
  gaps
  prescriptions
  plans
  plan_items

practice
  generation_specs
  generated_exercise_sets
  assignments
  assignment_items
  attempts
  attempt_answers

files
  uploads

ai/cost
  ai_usage_events
  ai_operation_cost_rollup
```

------------------------------------------------------------------------

# 12. ERD logic

``` text
USER
 |--< USER_ROLE
 |
 |-- PARENT --------< PARENT_CHILD_RELATIONSHIP >-------- CHILD
 |                                                       |
 |-- STUDENT_ACCOUNT_LINK -------------------------------|
 |                                                       |
 |-- TEACHER --< TEACHER_CHILD_LINK >--------------------|
 |       |                                               |
 |       +--< TEACHER_PARENT_LINK >-- PARENT             |
 |       +--< TEACHER_SCHOOL_MEMBERSHIP >-- SCHOOL       |
 |       +--< TEACHER_CLASS_ASSIGNMENT >-- CLASSROOM     |
 |                                                       |
 SCHOOL --< CLASSROOM >-- ACADEMIC_YEAR                  |
                  |                                      |
                  +--< STUDENT_CLASS_ENROLLMENT >--------|
                                                         |
 CHILD --< SCHOOL_ENROLLMENT >-- SCHOOL                  |
 CHILD --< ENROLLMENT_TRANSITION                         |
                                                         |
 CHILD --< LEARNING_CONTEXT / TWIN / GAP / PLAN          |
 CHILD --< ASSIGNMENT --< ATTEMPT --< EVIDENCE           |
```

------------------------------------------------------------------------

# 13. State Machines

## 13.1 Teacher connection

``` text
PENDING
  |-- accept by required party --> ACCEPTED
  |-- reject -------------------> REJECTED
  |-- timeout ------------------> EXPIRED

ACCEPTED
  |-- revoke by Parent/authorized actor --> REVOKED
```

Teacher-initiated Child connection: **PENDING -\> Parent ACCEPT -\>
ACCEPTED**.

Không có Parent approval thì không có child-data access.

## 13.2 Enrollment

``` text
PROPOSED -> ACTIVE -> COMPLETED
              |
              +-> TRANSFERRED
              +-> WITHDRAWN
              +-> REPEATED
```

------------------------------------------------------------------------

# 14. API boundaries đề xuất

``` text
POST /auth/register
POST /auth/login
GET  /me/roles
POST /me/switch-workspace

POST /children
GET  /children/:id

GET  /schools/search
POST /schools/propose
GET  /schools/:id/classes

POST /children/:id/enrollments
POST /children/:id/enrollment-transitions/:transitionId/confirm

POST /relationship-requests
GET  /relationship-requests/inbox
POST /relationship-requests/:id/accept
POST /relationship-requests/:id/reject
POST /relationships/:id/revoke

POST /teacher/children/:childId/contributions
GET  /teacher/children/:childId/permissions

GET  /children/:id/learning-context
GET  /children/:id/today
```

Tất cả child routes phải kiểm tra ABAC/RBAC + relationship permission.

------------------------------------------------------------------------

# 15. Security & Privacy Invariants

1.  Teacher không thể tự tạo active Teacher--Child link.
2.  Teacher-initiated link chỉ active sau Parent/Guardian approval.
3.  Classroom membership không tự grant Learning Twin access.
4.  Teacher chỉ input/read đúng subject/scope.
5.  Relationship revoke phải có hiệu lực ngay cho future access.
6.  Không xóa lịch sử contribution/evidence chỉ vì relationship bị
    revoke; retention/deletion theo privacy policy riêng.
7.  Child-facing API projection không trả parent-only analytics.
8.  Không dùng school/class identity làm global mastery identity.
9.  Audit mọi accept/reject/revoke/permission change.
10. Không cho teacher search tùy ý toàn bộ trẻ em theo tên/PII.
    Discovery phải dùng invite code, parent identifier an toàn, class
    join workflow hoặc cơ chế privacy-preserving tương đương.

------------------------------------------------------------------------

# 16. Acceptance Tests bắt buộc

### Identity

1.  Parent tạo Child mà Child chưa có account.
2.  Student đăng ký sau và link đúng Child, không duplicate.
3.  Một User có PARENT + TEACHER role và switch workspace được.

### Relationship hai chiều

4.  Parent mời Teacher -\> Teacher accept -\> quyền active.
5.  Teacher mời Parent/Child -\> trước Parent accept, Teacher không
    đọc/ghi child learning data.
6.  Parent accept -\> chỉ permission được đề xuất/approve mới active.
7.  Parent reject -\> không tạo active relationship.
8.  Parent revoke -\> future teacher access bị chặn ngay.
9.  Teacher--Parent link không tự tạo Teacher--Child link.
10. Teacher--Class link không tự grant full Learning Twin.

### School/Class

11. Hai trường cùng tên khác địa chỉ không merge.
12. Classroom cùng tên nhưng khác academic year là entity khác.
13. Parent chọn classroom đã tồn tại.
14. Parent có thể giữ Child PRIVATE dù classroom tồn tại.
15. LINKED_PRIVATE nhận class context nhưng teacher không thấy Twin.
16. LINKED_SHARED chỉ chia field theo permission.

### Academic progression

17. 2026-27 Grade 7 -\> proposal 2027-28 Grade 8.
18. `7C0 -> 8C0` chỉ suggestion, không fact.
19. Parent đổi suggestion thành `8A2`.
20. Chuyển trường tạo enrollment mới, không overwrite lịch sử.
21. Grade 5-\>6 và 9-\>10 yêu cầu school confirmation.
22. Repeat grade không auto +1.
23. Learning Twin vẫn cùng child_id sau chuyển trường/lớp.

### Learning architecture

24. Teacher CURRENT_LESSON contribution đi vào evidence/resolver, không
    update Twin trực tiếp.
25. Conflicting teacher/parent/schoolwork evidence vẫn qua Resolver.
26. Teacher contribution có provenance + relationship_source_id.
27. Subject-specific teacher không ghi dữ liệu subject ngoài permission.
28. Assignment/attempt/evidence đều trace được về child_id.

------------------------------------------------------------------------

# 17. Migration Strategy

Không big-bang rewrite.

## Phase I0 --- Audit only

-   map schema hiện tại;
-   xác định bảng/field đã có;
-   xác định FK đang dùng `user_id` nơi đáng ra là `child_id`;
-   tìm assumptions `one user = one role`;
-   tìm assumptions `child = auth user`;
-   tìm assumptions `class membership = sharing`.

## Phase I1 --- Identity/Family additive

-   users/user_roles;
-   parent/teacher profiles;
-   children;
-   parent_child_relationships;
-   student_account_links.

## Phase I2 --- School/Class/Subject

-   schools;
-   academic_years;
-   subjects;
-   classrooms;
-   teacher memberships/assignments.

## Phase I3 --- Enrollment

-   student school/class enrollment;
-   privacy mode;
-   transition history.

## Phase I4 --- Relationship/Permission

-   relationship_requests;
-   teacher_child_links;
-   teacher_parent_links;
-   permission sets/grants;
-   accept/reject/revoke state machine.

## Phase I5 --- Teacher contributions

-   subject-scoped contributions;
-   evidence adapter;
-   Resolver integration.

## Phase I6 --- Academic Progression Engine

-   proposed next-year enrollment;
-   grade transition policy;
-   class-name suggestion;
-   school boundary rules.

## Phase I7 --- UI/workspaces

-   Parent/Student/Teacher auth UX;
-   role switch;
-   invite/approval inbox;
-   school/class picker;
-   privacy controls.

Mỗi phase: additive schema -\> tests -\> API -\> UI -\>
migration/compatibility -\> remove legacy assumption later.

------------------------------------------------------------------------

# 18. Ready-to-paste Claude Prompt

``` text
APPROVED PRODUCT ARCHITECTURE UPDATE:
DạyZi Identity + Family + School + Classroom + Learning Relationships.

IMPORTANT:
This task is ARCHITECTURE AUDIT + SPEC + MIGRATION PLAN FIRST.
DO NOT implement feature code yet.
DO NOT run paid AI benchmark.
DO NOT enable LIVE generation.
DO NOT remove legacy practice path.

Read the existing locked product/technical docs and current repository before proposing changes.

LOCK THESE PRODUCT INVARIANTS:

1. Child != User.
A Child Profile must exist without a Student login account.
Student login may later link to the existing Child.

2. User identity supports multiple roles:
PARENT, STUDENT, TEACHER.
Each has an independent workspace/UX and permissions.
One identity may hold multiple roles.

3. Parent and Teacher can BOTH initiate relationship requests.

PARENT-INITIATED:
Parent -> Teacher request -> Teacher accepts/rejects.

TEACHER-INITIATED:
Teacher -> Parent/Child connection request -> Parent/authorized guardian
MUST accept before any Child relationship or Child-data permission becomes active.

Teacher must never gain Child access merely by sending a request.

4. Teacher relationships are independent:
Teacher-School
Teacher-Class
Teacher-Parent
Teacher-Child

Do not infer one automatically from another unless an explicit policy creates a
separate scoped grant.

5. Relationship != data sharing.
Class membership != Learning Twin sharing.
Use explicit scoped permissions.

6. Support privacy modes:
PRIVATE_LEARNING
LINKED_PRIVATE
LINKED_SHARED.

7. School/Class/Teacher data are evidence for Learning Context.
They are NOT absolute truth.
They must continue through provenance + LearningContextResolver.

8. Learning Twin follows child_id across school/class/year changes.

9. Do not overwrite historical enrollment.
School/class changes create new enrollment/history records.

10. Academic year progression:
2026-2027 Grade 7 may produce a SYSTEM PROPOSAL for 2027-2028 Grade 8.
Class name such as 7C0 -> 8C0 is only a suggestion.
Parent/authorized actor may change class.
School transfer creates new enrollment.
Grade 5->6 and Grade 9->10 require school confirmation.
Support repeat-grade and manual correction.

11. Database:
PostgreSQL / Supabase Postgres is the primary structured-data store.
Private object storage stores scans/images/PDFs.
Do not store file binaries in Postgres.

12. Subject is a first-class entity.
Teacher permissions and learning context must be subject-scoped.

AUDIT CURRENT REPOSITORY FOR:

- child/user coupling;
- one-role assumptions;
- existing family entities;
- existing teacher_scopes;
- enrollment model;
- classroom/school model;
- privacy model;
- auth assumptions;
- APIs using user_id instead of child_id;
- Learning Context dependencies;
- assignments/attempt/evidence ownership;
- existing PostgreSQL migrations;
- compatibility risks with current C4/C5 generation architecture.

PRODUCE DOCS ONLY:

docs/implementation/19_IDENTITY_FAMILY_MODEL.md
docs/implementation/20_SCHOOL_CLASS_ENROLLMENT_MODEL.md
docs/implementation/21_LEARNING_RELATIONSHIP_PERMISSION_MODEL.md
docs/implementation/22_AUTH_AND_WORKSPACE_ARCHITECTURE.md
docs/implementation/23_DATABASE_MIGRATION_PLAN.md
docs/implementation/24_ACADEMIC_PROGRESSION_ENGINE.md
docs/implementation/25_IDENTITY_RELATIONSHIP_API_PLAN.md
docs/implementation/26_IDENTITY_RELATIONSHIP_GOLDEN_TEST_PLAN.md
docs/implementation/27_IDENTITY_MIGRATION_ROADMAP.md

Also update:
docs/implementation/PENDING_APPROVAL.md

REQUIRED DATA MODEL COVERAGE:

users
user_roles
parent_profiles
teacher_profiles
families
family_memberships
children
parent_child_relationships
student_account_links

schools
academic_years
subjects
classrooms
class_cohorts optional

teacher_school_memberships
teacher_class_assignments
student_school_enrollments
student_class_enrollments
enrollment_transitions

relationship_requests
teacher_child_links
teacher_parent_links
permission_sets
permission_grants

teacher_learning_contributions
consent_records
privacy_preferences

Explain which existing tables can be reused vs added vs deprecated.

RELATIONSHIP REQUEST STATE MACHINE:

PENDING -> ACCEPTED
PENDING -> REJECTED
PENDING -> EXPIRED
ACCEPTED -> REVOKED

For Teacher-initiated Child request:
PENDING must grant ZERO Child learning-data access.
Only Parent/authorized guardian ACCEPT may activate it.

Define concurrency/idempotency:
- duplicate pending invitations;
- Parent and Teacher inviting each other simultaneously;
- repeated accept/reject requests;
- revoke after accept;
- expired request then new request;
- multiple guardians;
- teacher has both CLASS and PARENT_DIRECT grants.

PERMISSION MODEL:

At minimum evaluate:
VIEW_CLASS_CONTEXT
SUBMIT_CURRENT_LESSON
SUBMIT_CURRICULUM_PROGRESS
SUBMIT_HOMEWORK
SUBMIT_TEST_RESULT
SUBMIT_EXAM_NOTICE
SUBMIT_EXAM_SCOPE
SUBMIT_SKILL_ASSESSMENT
SUBMIT_LEARNING_OBSERVATION
CREATE_ASSIGNMENT
VIEW_ASSIGNMENT_COMPLETION
VIEW_SELECTED_MASTERY
VIEW_SELECTED_GAPS
VIEW_LEARNING_TWIN_SUMMARY
MESSAGE_PARENT

Sensitive Twin/Gap permissions default OFF.

SECURITY:
Do not allow unrestricted Teacher search across child PII.
Propose privacy-preserving discovery/invite flows.

ACADEMIC PROGRESSION:
Design deterministic policy and state machine, but keep class/school uncertainty
explicit.
Do not mutate previous-year enrollment.

GOLDEN/ACCEPTANCE TESTS MUST INCLUDE:

- Child without login;
- Student later links Child;
- multi-role Parent+Teacher user;
- Parent invites Teacher;
- Teacher invites Parent/Child and has ZERO access before Parent acceptance;
- accept/reject/revoke;
- simultaneous invitations;
- Teacher-Class does not imply Twin access;
- LINKED_PRIVATE vs LINKED_SHARED;
- same class name different academic year;
- same school name different address;
- Grade 7 -> Grade 8 proposal;
- 7C0 -> 8C0 is suggestion only;
- class change;
- school transfer;
- Grade 5->6 and Grade 9->10 boundary;
- repeat grade;
- Twin continuity across enrollment changes;
- teacher contribution -> evidence/resolver, not direct Twin mutation;
- subject-scope enforcement.

REPORT BACK:

1. current-state audit;
2. conflicts with existing architecture;
3. proposed ERD;
4. exact table plan;
5. relationship state machines;
6. permission matrix;
7. auth/workspace model;
8. enrollment/progression model;
9. API plan;
10. migration sequence;
11. backward compatibility plan;
12. Golden/acceptance test plan;
13. risks/open questions;
14. recommended implementation groups and dependencies.

STOP after docs/spec/migration plan.
Wait for approval before coding.
```

------------------------------------------------------------------------

# 19. Definition of Done cho architecture này

Architecture được coi là khóa khi:

-   Child/User tách rõ;
-   multi-role user rõ;
-   Parent và Teacher đều initiate được request;
-   Teacher-initiated Child relationship luôn cần Parent approval;
-   permission scoped;
-   school/year/class/enrollment có lịch sử;
-   progression không overwrite;
-   Learning Twin giữ continuity;
-   PostgreSQL ownership rõ;
-   assignment/attempt/evidence trace child_id;
-   API/DB migration plan additive;
-   Golden tests phủ relationship + enrollment + privacy;
-   Claude audit xong và dừng trước implementation.
