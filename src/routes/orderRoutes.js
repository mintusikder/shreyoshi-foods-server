
const express = require("express");
const { ObjectId } = require("mongodb");
const crypto = require("crypto");
const { getDB } = require("../config/db");
const verifyAdmin = require("../middleware/verifyAdmin");
const verifyAuth = require("../middleware/verifyAuth");

const optionalAuth = verifyAuth.optionalAuth;

const router = express.Router();

const FREE_DELIVERY_LIMIT = 3000;
const DELIVERY_CHARGE = 80;

const allowedPaymentMethods = ["cod", "bkash", "online"];

const allowedOrderStatuses = [
  "new",
  "confirmed",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
];

// CREATE ORDER
// Logged-in customer: save userId
// Guest customer: allow order without userId
router.post("/", optionalAuth, async (req, res) => {
  try {
    const db = getDB();

    const {
      customer,
      shippingAddress,
      items,
      paymentMethod,
      note,
    } = req.body;

    // Validate customer information
    if (
      !customer ||
      !String(customer.name || "").trim() ||
      !/^01[3-9]\d{8}$/.test(
        String(customer.phone || "").replace(/\s/g, "")
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "সঠিক Customer Name এবং Phone Number দিন",
      });
    }

    // Validate shipping address
    if (
      !shippingAddress ||
      !String(shippingAddress.district || "").trim() ||
      !String(shippingAddress.area || "").trim() ||
      !String(shippingAddress.address || "").trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "সম্পূর্ণ Delivery Address দিন",
      });
    }

    // Validate payment method
    if (!allowedPaymentMethods.includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment method",
      });
    }

    // Validate items
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "আপনার Order-এ কোনো Product নেই",
      });
    }

    if (items.length > 50) {
      return res.status(400).json({
        success: false,
        message: "একটি Order-এ সর্বোচ্চ ৫০টি আলাদা Product দেওয়া যাবে",
      });
    }

    // Merge duplicate product IDs and validate quantities
    const quantityMap = new Map();

    for (const item of items) {
      const productId = String(item.productId || "");
      const quantity = Number(item.quantity);

      if (!ObjectId.isValid(productId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid Product ID",
        });
      }

      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
        return res.status(400).json({
          success: false,
          message: "Invalid Product Quantity",
        });
      }

      const newQuantity =
        (quantityMap.get(productId) || 0) + quantity;

      if (newQuantity > 100) {
        return res.status(400).json({
          success: false,
          message: "একটি Product-এর সর্বোচ্চ Quantity ১০০ হতে পারবে",
        });
      }

      quantityMap.set(productId, newQuantity);
    }

    const productsCollection = db.collection("products");
    const orderItems = [];

    let subtotal = 0;

    // Get real product data from MongoDB
    for (const [productId, quantity] of quantityMap.entries()) {
      const product = await productsCollection.findOne({
        _id: new ObjectId(productId),
        status: "published",
      });

      if (!product) {
        return res.status(400).json({
          success: false,
          message: "একটি Product আর Available নেই। Cart আপডেট করুন।",
        });
      }

      const stockQuantity = Number(product.stockQuantity || 0);

      if (stockQuantity < quantity) {
        return res.status(400).json({
          success: false,
          message: `${product.name} এর পর্যাপ্ত Stock নেই। Available: ${stockQuantity}`,
        });
      }

      const regularPrice = Number(product.regularPrice || 0);
      const salePrice = Number(product.salePrice || 0);

      const unitPrice =
        salePrice > 0 && salePrice < regularPrice
          ? salePrice
          : regularPrice;

      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        return res.status(400).json({
          success: false,
          message: `${product.name} এর Price সঠিক নয়`,
        });
      }

      const lineTotal = unitPrice * quantity;

      subtotal += lineTotal;

      orderItems.push({
        productId: product._id,
        name: product.name,
        slug: product.slug || "",
        image: product.images?.main || "",
        regularPrice,
        unitPrice,
        quantity,
        lineTotal,
      });
    }

    // Calculate delivery charge on the server
    const deliveryCharge =
      subtotal >= FREE_DELIVERY_LIMIT ? 0 : DELIVERY_CHARGE;

    const total = subtotal + deliveryCharge;

    const orderId = `SF-${Date.now()}-${crypto
      .randomBytes(2)
      .toString("hex")
      .toUpperCase()}`;

    // Create order
    const order = {
      orderId,

      customer: {
        ...(req.user?.id
          ? { userId: String(req.user.id) }
          : {}),
        name: String(customer.name).trim(),
        phone: String(customer.phone).replace(/\s/g, ""),
        email: String(customer.email || "").trim(),
      },

      shippingAddress: {
        district: String(shippingAddress.district).trim(),
        area: String(shippingAddress.area).trim(),
        address: String(shippingAddress.address).trim(),
      },

      items: orderItems,

      pricing: {
        subtotal,
        deliveryCharge,
        total,
      },

      payment: {
        method: paymentMethod,
        status: "unpaid",
      },

      note: String(note || "").trim(),

      orderStatus: "new",

      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await db.collection("orders").insertOne(order);

    res.status(201).json({
      success: true,
      message: "আপনার অর্ডার সফলভাবে গ্রহণ করা হয়েছে",
      order: {
        _id: result.insertedId,
        orderId,
        total,
        orderStatus: order.orderStatus,
      },
    });
  } catch (error) {
    console.error("Create Order Error:", error);

    res.status(500).json({
      success: false,
      message: "অর্ডার তৈরি করা যায়নি। আবার চেষ্টা করুন।",
    });
  }
});

// CUSTOMER: GET LOGGED-IN USER'S ORDERS
router.get("/my", verifyAuth, async (req, res) => {
  try {
    const db = getDB();

    const userId = String(req.user.id);

    const orders = await db
      .collection("orders")
      .find({
        "customer.userId": userId,
      })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json({
      success: true,
      total: orders.length,
      orders,
    });
  } catch (error) {
    console.error("Get My Orders Error:", error);

    res.status(500).json({
      success: false,
      message: "আপনার অর্ডার লোড করা যায়নি",
    });
  }
});

// ADMIN: GET ALL ORDERS
router.get("/admin/all", verifyAdmin, async (req, res) => {
  try {
    const db = getDB();

    const orders = await db
      .collection("orders")
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json({
      success: true,
      total: orders.length,
      orders,
    });
  } catch (error) {
    console.error("Get Orders Error:", error);

    res.status(500).json({
      success: false,
      message: "অর্ডার লোড করা যায়নি",
    });
  }
});

// ADMIN: UPDATE ORDER STATUS
router.put("/admin/:id/status", verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { orderStatus } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Order ID",
      });
    }

    if (!allowedOrderStatuses.includes(orderStatus)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Order Status",
      });
    }

    const db = getDB();

    const result = await db.collection("orders").updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          orderStatus,
          updatedAt: new Date(),
        },
      }
    );

    if (!result.matchedCount) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Order status updated successfully",
    });
  } catch (error) {
    console.error("Update Order Status Error:", error);

    res.status(500).json({
      success: false,
      message: "Order status update failed",
    });
  }
});

module.exports = router;
