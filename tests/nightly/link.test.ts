import { describe, it, expect } from "vitest";
import { decideLinking } from "../../src/nightly/link.js";

const sampleIndex = {
  services: [
    { name: "order-service", file: "services/order-service.yaml", summary: "Orders", endpoints_count: 12 },
    { name: "inventory-service", file: "services/inventory-service.yaml", summary: "Inventory", endpoints_count: 8 },
    { name: "comms-service", file: "services/comms-service.yaml", summary: "Comms", endpoints_count: 4 },
    { name: "logging-service", file: "services/logging-service.yaml", summary: "Logging", endpoints_count: 2 },
  ],
  flows: [
    { name: "Place Order", file: "flows/orders/place-order.yaml", summary: "Order creation", services: ["order-service", "inventory-service", "comms-service"] },
    { name: "Cancel Order", file: "flows/orders/cancel-order.yaml", summary: "Order cancellation", services: ["order-service", "inventory-service"] },
    { name: "Send Notification", file: "flows/comms/send-notification.yaml", summary: "Send notif", services: ["comms-service", "logging-service"] },
  ],
};

describe("decideLinking", () => {
  it("links everything when no failures", () => {
    const decision = decideLinking([], sampleIndex);
    expect(decision.shouldLink).toBe(true);
    expect(decision.skipFlows).toEqual([]);
  });

  it("skips flows involving failed services", () => {
    const decision = decideLinking(["comms-service"], sampleIndex);
    expect(decision.shouldLink).toBe(true);
    expect(decision.skipFlows).toContain("Place Order");
    expect(decision.skipFlows).toContain("Send Notification");
    expect(decision.skipFlows).not.toContain("Cancel Order");
  });

  it("allows full linking when failed service has no flows", () => {
    const decision = decideLinking(["logging-service"], sampleIndex);
    // logging-service is in Send Notification flow
    expect(decision.shouldLink).toBe(true);
    expect(decision.skipFlows).toContain("Send Notification");
    expect(decision.skipFlows).not.toContain("Place Order");
    expect(decision.skipFlows).not.toContain("Cancel Order");
  });

  it("skips linking entirely when all flows are affected", () => {
    const decision = decideLinking(["order-service", "comms-service"], sampleIndex);
    // All 3 flows involve order-service or comms-service
    expect(decision.shouldLink).toBe(false);
    expect(decision.skipFlows).toHaveLength(3);
  });

  it("handles missing index gracefully", () => {
    const decision = decideLinking(["order-service"], { services: [], flows: [] });
    expect(decision.shouldLink).toBe(true);
    expect(decision.skipFlows).toEqual([]);
  });
});
