// migrations/20260527120000-add-delivery-and-shipment.js
module.exports = {
  async up(db) {
    const collections = await db.listCollections().toArray();
    const names = collections.map((c) => c.name);

    // =========================
    // SHIPMENTS COLLECTION
    // =========================
    if (!names.includes("shipments")) {
      await db.createCollection("shipments");
    }

    await db.collection("shipments").createIndexes([
      { key: { orderId: 1 }, unique: true, name: "orderId_unique" },
      { key: { awbCode: 1 }, name: "awbCode_idx" },
      { key: { status: 1 }, name: "status_idx" },
      { key: { createdAt: -1 }, name: "createdAt_desc" },
      { key: { shiprocketOrderId: 1 }, name: "shiprocketOrderId_idx" },
      { key: { courierName: 1 }, name: "courierName_idx" },
    ]);

    // =========================
    // ADD SHIPPING DIMENSIONS TO PRODUCTVARIANTS
    // =========================
    const variantsCollection = db.collection("productvariants");
    const variantDocs = await variantsCollection.find({}).toArray();
    for (const variant of variantDocs) {
      if (!variant.dimensions) {
        await variantsCollection.updateOne(
          { _id: variant._id },
          {
            $set: {
              dimensions: {
                weight: 0.5, // kg, default
                length: 10, // cm
                width: 10,
                height: 10,
              },
            },
          },
        );
      }
    }

    // Index for faster dimensions queries
    await variantsCollection.createIndex(
      { "dimensions.weight": 1 },
      { name: "dimensions_weight_idx" },
    );

    // =========================
    // ADD SHIPMENT FIELDS TO ORDERS (for quick access)
    // =========================
    await db.collection("orders").updateMany(
      {},
      {
        $set: {
          shipmentId: null,
          deliveryStatus: "pending", // pending, assigned, picked_up, in_transit, delivered, failed
          trackingNumber: null,
          courierName: null,
          awbCode: null,
          shippedAt: null,
          estimatedDeliveryDate: null,
        },
      },
    );

    await db.collection("orders").createIndexes([
      { key: { deliveryStatus: 1 }, name: "deliveryStatus_idx" },
      { key: { trackingNumber: 1 }, sparse: true, name: "trackingNumber_idx" },
    ]);

    console.log(
      "✅ Shipments collection, variant dimensions, and order fields added.",
    );
  },

  async down(db) {
    await db
      .collection("shipments")
      .drop()
      .catch(() => {});
    await db
      .collection("productvariants")
      .updateMany({}, { $unset: { dimensions: "" } });
    await db.collection("orders").updateMany(
      {},
      {
        $unset: {
          shipmentId: "",
          deliveryStatus: "",
          trackingNumber: "",
          courierName: "",
          awbCode: "",
          shippedAt: "",
          estimatedDeliveryDate: "",
        },
      },
    );
    console.log("✅ Migration rolled back.");
  },
};
