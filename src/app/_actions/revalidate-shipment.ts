import { revalidatePath } from "next/cache";

/** Both surfaces show the shipment; revalidating a path the caller cannot open is harmless. */
export function revalidateShipment(id: string): void {
  revalidatePath(`/dashboard/shipments/${id}`);
  revalidatePath("/dashboard/shipments");
  revalidatePath(`/driver/shipments/${id}`);
  revalidatePath("/driver");
}
