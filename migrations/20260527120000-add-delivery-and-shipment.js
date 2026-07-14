// migrations/20260527120000-add-delivery-and-shipment.js (COMPLETE UPDATED VERSION)
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

    const shipmentsCollection = db.collection("shipments");

    // Get existing indexes
    let existingIndexes = await shipmentsCollection.indexes();
    let indexNames = existingIndexes.map((idx) => idx.name);

    // Drop conflicting indexes
    const conflicts = [
      { name: "orderId_1", newName: "orderId_unique" },
      { name: "awbCode_1", newName: "awbCode_idx" },
      { name: "status_1", newName: "status_idx" },
      { name: "createdAt_-1", newName: "createdAt_desc" },
    ];

    for (const conflict of conflicts) {
      if (indexNames.includes(conflict.name)) {
        try {
          await shipmentsCollection.dropIndex(conflict.name);
          console.log(`✅ Dropped conflicting index: ${conflict.name}`);
        } catch (err) {
          console.warn(
            `⚠️ Could not drop index ${conflict.name}:`,
            err.message,
          );
        }
      }
    }

    // Refresh indexes list
    existingIndexes = await shipmentsCollection.indexes();
    indexNames = existingIndexes.map((idx) => idx.name);

    // Create our indexes
    const indexesToCreate = [
      { key: { orderId: 1 }, unique: true, name: "orderId_unique" },
      { key: { awbCode: 1 }, name: "awbCode_idx" },
      { key: { status: 1 }, name: "status_idx" },
      { key: { createdAt: -1 }, name: "createdAt_desc" },
      { key: { shiprocketOrderId: 1 }, name: "shiprocketOrderId_idx" },
      { key: { courierName: 1 }, name: "courierName_idx" },
    ];

    for (const indexDef of indexesToCreate) {
      if (!indexNames.includes(indexDef.name)) {
        try {
          await shipmentsCollection.createIndex(indexDef.key, {
            unique: indexDef.unique || false,
            name: indexDef.name,
          });
          console.log(`✅ Created index: ${indexDef.name}`);
        } catch (err) {
          console.warn(
            `⚠️ Could not create index ${indexDef.name}:`,
            err.message,
          );
        }
      } else {
        console.log(`⏭️ Index ${indexDef.name} already exists, skipping`);
      }
    }

    // =========================
    // ADD SHIPPING DIMENSIONS TO PRODUCTVARIANTS
    // =========================
    const variantsCollection = db.collection("productvariants");
    const variantDocs = await variantsCollection.find({}).toArray();
    let updatedCount = 0;

    for (const variant of variantDocs) {
      if (!variant.dimensions) {
        await variantsCollection.updateOne(
          { _id: variant._id },
          {
            $set: {
              dimensions: {
                weight: 0.5,
                length: 10,
                width: 10,
                height: 10,
              },
            },
          },
        );
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      console.log(`✅ Added dimensions to ${updatedCount} variants`);
    } else {
      console.log("✅ All variants already have dimensions");
    }

    // Index for dimensions
    const variantIndexes = await variantsCollection.indexes();
    const variantIndexNames = variantIndexes.map((idx) => idx.name);

    if (!variantIndexNames.includes("dimensions_weight_idx")) {
      await variantsCollection.createIndex(
        { "dimensions.weight": 1 },
        { name: "dimensions_weight_idx" },
      );
      console.log("✅ Created dimensions_weight_idx");
    } else {
      console.log("⏭️ dimensions_weight_idx already exists");
    }

    // =========================
    // ADD SHIPMENT FIELDS TO ORDERS
    // =========================
    const ordersCollection = db.collection("orders");

    // Add fields if they don't exist
    const orderDocs = await ordersCollection.find({}).toArray();
    let orderUpdatedCount = 0;

    for (const order of orderDocs) {
      const updates = {};
      let needsUpdate = false;

      if (order.shipmentId === undefined) {
        updates.shipmentId = null;
        needsUpdate = true;
      }
      if (order.deliveryStatus === undefined) {
        updates.deliveryStatus = "pending";
        needsUpdate = true;
      }
      if (order.trackingNumber === undefined) {
        updates.trackingNumber = null;
        needsUpdate = true;
      }
      if (order.courierName === undefined) {
        updates.courierName = null;
        needsUpdate = true;
      }
      if (order.awbCode === undefined) {
        updates.awbCode = null;
        needsUpdate = true;
      }
      if (order.shippedAt === undefined) {
        updates.shippedAt = null;
        needsUpdate = true;
      }
      if (order.estimatedDeliveryDate === undefined) {
        updates.estimatedDeliveryDate = null;
        needsUpdate = true;
      }

      if (needsUpdate) {
        await ordersCollection.updateOne({ _id: order._id }, { $set: updates });
        orderUpdatedCount++;
      }
    }

    if (orderUpdatedCount > 0) {
      console.log(
        `✅ Updated ${orderUpdatedCount} orders with shipment fields`,
      );
    } else {
      console.log("✅ All orders already have shipment fields");
    }

    // =========================
    // CREATE INDEXES ON ORDERS - WITH BETTER ERROR HANDLING
    // =========================

    // First, check existing indexes
    let orderIndexes = await ordersCollection.indexes();
    let orderIndexNames = orderIndexes.map((idx) => idx.name);

    // Drop conflicting trackingNumber index if it exists
    if (orderIndexNames.includes("trackingNumber_1")) {
      try {
        await ordersCollection.dropIndex("trackingNumber_1");
        console.log("✅ Dropped conflicting index: trackingNumber_1");
      } catch (err) {
        console.warn("⚠️ Could not drop trackingNumber_1:", err.message);
      }
    }

    // Also drop any other conflicting order indexes
    if (orderIndexNames.includes("deliveryStatus_1")) {
      try {
        await ordersCollection.dropIndex("deliveryStatus_1");
        console.log("✅ Dropped conflicting index: deliveryStatus_1");
      } catch (err) {
        console.warn("⚠️ Could not drop deliveryStatus_1:", err.message);
      }
    }

    // Refresh indexes list
    orderIndexes = await ordersCollection.indexes();
    orderIndexNames = orderIndexes.map((idx) => idx.name);

    // Create deliveryStatus index
    if (!orderIndexNames.includes("deliveryStatus_idx")) {
      try {
        await ordersCollection.createIndex(
          { deliveryStatus: 1 },
          { name: "deliveryStatus_idx" },
        );
        console.log("✅ Created deliveryStatus_idx");
      } catch (err) {
        console.warn("⚠️ Could not create deliveryStatus_idx:", err.message);
      }
    } else {
      console.log("⏭️ deliveryStatus_idx already exists");
    }

    // Create trackingNumber index with sparse option
    if (!orderIndexNames.includes("trackingNumber_idx")) {
      try {
        await ordersCollection.createIndex(
          { trackingNumber: 1 },
          { sparse: true, name: "trackingNumber_idx" },
        );
        console.log("✅ Created trackingNumber_idx");
      } catch (err) {
        console.warn("⚠️ Could not create trackingNumber_idx:", err.message);
        // If it fails, try without sparse option
        if (err.message.includes("index already exists")) {
          // Check if index exists with different name
          const indexes = await ordersCollection.indexes();
          const trackingIndex = indexes.find(
            (idx) =>
              JSON.stringify(idx.key) === JSON.stringify({ trackingNumber: 1 }),
          );
          if (trackingIndex) {
            console.log(
              `⚠️ Index already exists as ${trackingIndex.name}, skipping`,
            );
          } else {
            // Try without sparse
            try {
              await ordersCollection.createIndex(
                { trackingNumber: 1 },
                { name: "trackingNumber_idx" },
              );
              console.log("✅ Created trackingNumber_idx (without sparse)");
            } catch (retryErr) {
              console.error(
                "❌ Failed to create trackingNumber_idx:",
                retryErr.message,
              );
            }
          }
        }
      }
    } else {
      console.log("⏭️ trackingNumber_idx already exists");
    }

    console.log("✅ Migration completed successfully");
  },

  async down(db) {
    // Drop shipments collection
    try {
      await db.collection("shipments").drop();
      console.log("✅ Dropped shipments collection");
    } catch (err) {
      console.log("⚠️ Could not drop shipments collection:", err.message);
    }

    // Remove dimensions from variants
    try {
      await db
        .collection("productvariants")
        .updateMany({}, { $unset: { dimensions: "" } });
      console.log("✅ Removed dimensions from variants");
    } catch (err) {
      console.log("⚠️ Could not remove dimensions:", err.message);
    }

    // Remove shipment fields from orders
    try {
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
      console.log("✅ Removed shipment fields from orders");
    } catch (err) {
      console.log("⚠️ Could not remove shipment fields:", err.message);
    }

    console.log("✅ Migration rolled back");
  },
};
