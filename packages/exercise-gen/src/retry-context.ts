import type {
  ItemAcceptanceGate,
  ItemAcceptanceResult,
  ItemAnswerStatus,
  MathKernel,
} from '@copilot/domain';

/**
 * Failure-specific retry context (doc 63 §3). ONE bounded corrective instruction
 * derived from the failure category — never a dump of every validator message.
 * Deterministic; the same failure always yields the same instruction.
 */

export const RETRY_CONTEXT_VERSION = 'retry-context.v1';

export type RetryReason =
  | 'SIMILARITY_OR_DUPLICATE'
  | 'KERNEL_DRIFT'
  | 'SCHEMA'
  | 'LEAKAGE'
  | 'SEMANTIC_UNKNOWN'
  | 'CURRICULUM_OR_LEVEL'
  | 'OTHER';

export interface RetryContext {
  readonly reason: RetryReason;
  /** exactly one instruction line for the generator (Vietnamese, imperative). */
  readonly instruction: string;
}

function classify(result: ItemAcceptanceResult, answerStatus: ItemAnswerStatus | null): RetryReason {
  const failed = new Set<ItemAcceptanceGate>(result.failedGates);
  const detail = result.gates.filter((g) => !g.pass).map((g) => g.detail).join(' ');

  if (answerStatus === 'SEMANTIC_UNKNOWN') return 'SEMANTIC_UNKNOWN';
  if (failed.has('ANSWER_VERIFIED') && answerStatus === 'DETERMINISTIC_WRONG') return 'KERNEL_DRIFT';
  if (failed.has('SIMILARITY_OK') && /vs reference/i.test(detail)) return 'LEAKAGE';
  if (failed.has('SIMILARITY_OK') || failed.has('UNIQUENESS_OK')) return 'SIMILARITY_OR_DUPLICATE';
  if (failed.has('SCHEMA_VALID')) return 'SCHEMA';
  if (failed.has('CURRICULUM_SAFE') || failed.has('PREREQUISITE_SAFE') || failed.has('K_LEVEL_OK') || failed.has('T_LEVEL_OK') || failed.has('SKILL_ALIGNED')) {
    return 'CURRICULUM_OR_LEVEL';
  }
  return 'OTHER';
}

export function buildRetryContext(
  result: ItemAcceptanceResult,
  answerStatus: ItemAnswerStatus | null,
  kernel: MathKernel | null,
): RetryContext {
  const reason = classify(result, answerStatus);

  switch (reason) {
    case 'SIMILARITY_OR_DUPLICATE':
      return {
        reason,
        instruction:
          'Câu vừa sinh quá giống một câu khác trong phiếu. Hãy đổi HẲN bối cảnh (đồ vật, nhân vật, tình huống), đổi cách diễn đạt và — nếu được — đổi các con số cụ thể, giữ nguyên dạng toán.',
      };
    case 'KERNEL_DRIFT':
      return {
        reason,
        instruction: kernel
          ? `Lời giải/đáp số không khớp phần toán bắt buộc. GIỮ NGUYÊN: phép tính "${kernel.canonicalVerificationExpression ?? kernel.operationGraph.join('; ')}", các số ${kernel.requiredNumbersInPrompt.join(', ')}, đáp số ${JSON.stringify(kernel.expectedAnswer)}. Chỉ viết lại lời văn cho khớp.`
          : 'Lời giải và đáp số phải nhất quán với đề. Kiểm tra lại từng bước tính.',
      };
    case 'SCHEMA':
      return {
        reason,
        instruction:
          'Sửa ĐÚNG định dạng: đáp số dạng số phải là số (không phải chữ cái), phân số phải là {tử, mẫu}, đủ 6 bậc gợi ý, câu suy luận phải có rubric. Không đổi nội dung toán.',
      };
    case 'LEAKAGE':
      return {
        reason,
        instruction:
          'Câu trùng lặp với một ví dụ tham chiếu. Sinh câu MỚI HOÀN TOÀN về bối cảnh và số liệu, chỉ giữ dạng toán và mức độ.',
      };
    case 'SEMANTIC_UNKNOWN':
      return {
        reason,
        instruction: kernel
          ? `Chưa xác nhận được lời văn giữ đúng ý nghĩa toán. Hãy dùng cách diễn đạt ĐƠN GIẢN, TRỰC TIẾP hơn (ưu tiên nêu thẳng phương trình/phép tính ${kernel.canonicalVerificationExpression ?? ''}), vẫn giữ đúng số và đáp số.`
          : 'Dùng cách diễn đạt đơn giản, trực tiếp hơn, giữ nguyên phần toán.',
      };
    case 'CURRICULUM_OR_LEVEL':
      return {
        reason,
        instruction:
          'Câu vượt/không đúng phạm vi cho phép. Chỉ dùng kiến thức và mức độ (K/T) đã ghi trong yêu cầu; không thêm kỹ thuật ngoài chương trình.',
      };
    default:
      return { reason: 'OTHER', instruction: 'Sinh lại câu này theo đúng yêu cầu.' };
  }
}
