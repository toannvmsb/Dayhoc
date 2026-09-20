/** dd/mm/yyyy in Vietnam time — for "tạo ngày …" labels. */
export function formatViDate(value: string | Date): string {
  return new Date(value).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' });
}
