
const express = require("express");
const { getDB } = require("../config/db");
const verifyAdmin = require("../middleware/verifyAdmin");

const router = express.Router();

const ORDER_STATUSES = [
  "new",
  "confirmed",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
];

function getDateRange(query) {
  const now = new Date();
  const range = query.range || "30d";

  let startDate;
  let endDate = now;

  if (range === "today") {
    startDate = new Date(now);
    startDate.setHours(0, 0, 0, 0);
  } else if (range === "7d") {
    startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 6);
    startDate.setHours(0, 0, 0, 0);
  } else if (range === "30d") {
    startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 29);
    startDate.setHours(0, 0, 0, 0);
  } else if (range === "month") {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (range === "year") {
    startDate = new Date(now.getFullYear(), 0, 1);
  } else if (range === "custom") {
    const from = new Date(`${query.from}T00:00:00`);
    const to = new Date(`${query.to}T23:59:59.999`);

    if (
      !query.from ||
      !query.to ||
      Number.isNaN(from.getTime()) ||
      Number.isNaN(to.getTime()) ||
      from > to
    ) {
      return null;
    }

    startDate = from;
    endDate = to;
  } else {
    return undefined;
  }

  return { startDate, endDate };
}

// ADMIN: GET ANALYTICS
router.get("/", verifyAdmin, async (req, res) => {
  try {
    const db = getDB();
    const ordersCollection = db.collection("orders");
    const productsCollection = db.collection("products");

    const dateRange = getDateRange(req.query);

    if (dateRange === null) {
      return res.status(400).json({
        success: false,
        message: "সঠিক Custom Date Range দিন",
      });
    }

    if (dateRange === undefined) {
      return res.status(400).json({
        success: false,
        message: "Invalid analytics date range",
      });
    }

    const { startDate, endDate } = dateRange;

    const dateMatch = {
      createdAt: {
        $gte: startDate,
        $lte: endDate,
      },
    };

    const orders = await ordersCollection
      .find(dateMatch)
      .toArray();

    const validOrders = orders.filter(
      (order) => order.orderStatus !== "cancelled"
    );

    const totalOrders = orders.length;
    const cancelledOrders = orders.filter(
      (order) => order.orderStatus === "cancelled"
    ).length;

    const totalRevenue = validOrders.reduce(
      (sum, order) => sum + Number(order.pricing?.total || 0),
      0
    );

    const totalSubtotal = validOrders.reduce(
      (sum, order) => sum + Number(order.pricing?.subtotal || 0),
      0
    );

    const averageOrderValue = validOrders.length
      ? totalRevenue / validOrders.length
      : 0;

    // Order status breakdown
    const statusCounts = ORDER_STATUSES.map((status) => ({
      status,
      count: orders.filter(
        (order) => order.orderStatus === status
      ).length,
    }));

    // Revenue trend
    const revenueMap = new Map();

    for (const order of validOrders) {
      const date = new Date(order.createdAt);
      const dateKey = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Dhaka",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(date);

      const previous = revenueMap.get(dateKey) || {
        date: dateKey,
        revenue: 0,
        orders: 0,
      };

      previous.revenue += Number(order.pricing?.total || 0);
      previous.orders += 1;

      revenueMap.set(dateKey, previous);
    }

    const revenueTrend = Array.from(revenueMap.values()).sort(
      (a, b) => a.date.localeCompare(b.date)
    );

    // Top selling products
    const productMap = new Map();

    for (const order of validOrders) {
      for (const item of order.items || []) {
        const key = String(item.productId || item.slug || item.name);

        const previous = productMap.get(key) || {
          name: item.name || "Unnamed Product",
          slug: item.slug || "",
          quantity: 0,
          sales: 0,
        };

        previous.quantity += Number(item.quantity || 0);
        previous.sales += Number(item.lineTotal || 0);

        productMap.set(key, previous);
      }
    }

    const topProducts = Array.from(productMap.values())
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);

    // Customer insights (based on non-cancelled orders)
    const customerMap = new Map();

    for (const order of validOrders) {
      const phone = String(order.customer?.phone || "").trim();

      if (!phone) continue;

      const previous = customerMap.get(phone) || {
        name: order.customer?.name || "Customer",
        phone,
        orders: 0,
        spent: 0,
      };

      previous.orders += 1;
      previous.spent += Number(order.pricing?.total || 0);

      customerMap.set(phone, previous);
    }

    const customerList = Array.from(customerMap.values());

    const totalCustomers = customerList.length;
    const repeatCustomers = customerList.filter(
      (customer) => customer.orders > 1
    ).length;
    const newCustomers = customerList.filter(
      (customer) => customer.orders === 1
    ).length;

    // Current inventory (not affected by date filter)
    const products = await productsCollection
      .find({ status: "published" })
      .toArray();

    const totalProducts = products.length;

    const outOfStockProducts = products.filter(
      (product) => Number(product.stockQuantity || 0) <= 0
    );

    const lowStockProducts = products.filter((product) => {
      const stock = Number(product.stockQuantity || 0);
      return stock > 0 && stock <= 5;
    });

    const inventoryValue = products.reduce((sum, product) => {
      const stock = Number(product.stockQuantity || 0);
      const price = Number(
        product.salePrice > 0 &&
          product.salePrice < product.regularPrice
          ? product.salePrice
          : product.regularPrice || 0
      );

      return sum + stock * price;
    }, 0);

    res.status(200).json({
      success: true,
      range: {
        startDate,
        endDate,
      },
      overview: {
        totalRevenue,
        totalOrders,
        validOrders: validOrders.length,
        cancelledOrders,
        averageOrderValue,
        totalSubtotal,
        totalCustomers,
        repeatCustomers,
        newCustomers,
      },
      revenueTrend,
      orderStatuses: statusCounts,
      topProducts,
      inventory: {
        totalProducts,
        lowStock: lowStockProducts.length,
        outOfStock: outOfStockProducts.length,
        inventoryValue,
        lowStockProducts: lowStockProducts.slice(0, 5).map((product) => ({
          name: product.name,
          stock: Number(product.stockQuantity || 0),
        })),
        outOfStockProducts: outOfStockProducts.slice(0, 5).map((product) => ({
          name: product.name,
          stock: 0,
        })),
      },
    });
  } catch (error) {
    console.error("Get Analytics Error:", error);

    res.status(500).json({
      success: false,
      message: "Analytics data load করা যায়নি",
    });
  }
});

module.exports = router;
