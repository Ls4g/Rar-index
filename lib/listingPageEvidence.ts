export type StaffPageSignal = "green_sold" | "red_ended" | "still_live" | "unclear";

export function classifyStaffPageSignal(signal: StaffPageSignal) {
  switch (signal) {
    case "green_sold":
      return {
        listingState: "completed_sold",
        resultingStatus: "ambiguous",
        resolved: false,
        detail: "Staff observed both eBay's green sold styling and the adjacent sold wording. This supports a sale outcome, but does not prove the exact paid price or date.",
      } as const;
    case "red_ended":
      return {
        listingState: "completed_unsold",
        resultingStatus: "unsold",
        resolved: true,
        detail: "Staff observed both eBay's red ended styling and wording showing that the listing ended without a sale.",
      } as const;
    case "still_live":
      return {
        listingState: "active",
        resultingStatus: "active",
        resolved: false,
        detail: "Staff confirmed that the original eBay listing is still live.",
      } as const;
    case "unclear":
      return {
        listingState: "unknown",
        resultingStatus: "ambiguous",
        resolved: false,
        detail: "Staff checked the original eBay page, but its visible state did not clearly prove sold, unsold or still live.",
      } as const;
  }
}
