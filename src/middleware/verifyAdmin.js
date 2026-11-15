const verifyAdmin = async (req, res, next) => {
  try {
    const cookie = req.headers.cookie;

    if (!cookie) {
      return res.status(401).json({
        success: false,
        message: "Please login first",
      });
    }

    const clientURL = process.env.CLIENT_URL;

    if (!clientURL) {
      throw new Error("CLIENT_URL is missing");
    }

    const response = await fetch(
      `${clientURL.replace(/\/$/, "")}/api/auth/get-session`,
      {
        method: "GET",
        headers: {
          cookie,
        },
      }
    );

    if (!response.ok) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired session",
      });
    }

    const sessionData = await response.json();

    if (!sessionData?.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (sessionData.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Admin access required",
      });
    }

    req.user = sessionData.user;

    next();
  } catch (error) {
    console.error("Admin Verification Error:", error);

    res.status(500).json({
      success: false,
      message: "Authentication verification failed",
    });
  }
};

module.exports = verifyAdmin;