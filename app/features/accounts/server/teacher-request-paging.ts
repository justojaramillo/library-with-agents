import type { TeacherRequest } from "../schema";

/** Orden de las páginas: `requested_at` ascendente y, a igual fecha, por `member_id` (orden de código, igual que Firestore). */
export function compareRequestOrder(a: TeacherRequest, b: TeacherRequest): number {
  if (a.requested_at < b.requested_at) {
    return -1;
  }
  if (a.requested_at > b.requested_at) {
    return 1;
  }
  if (a.member_id < b.member_id) {
    return -1;
  }
  if (a.member_id > b.member_id) {
    return 1;
  }
  return 0;
}
