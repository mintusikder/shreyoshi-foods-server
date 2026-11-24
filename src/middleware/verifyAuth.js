
const getSessionUser = async (cookie) => {
  const clientURL = process.env.CLIENT_URL;

  if (!clientURL) {
    throw new Error("CLIENT_URL is missing");
  }

  const response = await fetch(
    `${clientURL.replace(/\/+$/, "")}/api/auth/get-session`,
    {
      method: "GET",
      headers: { cookie },
    }
  );

  if (!response.ok) return null;

  const sessionData = await response.json();

  return sessionData?.user || null;
};

// Required authentication
const verifyAuth = async (req, res, next) => {
  try {
    const cookie = req.headers.cookie;

    if (!cookie) {
      return res.status(401).json({
        success: false,
        message: "Please login first",
      });
    }

    const user = await getSessionUser(cookie);

    if (!user?.id) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired session",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("Authentication Error:", error);

    res.status(500).json({
      success: false,
      message: "Authentication verification failed",
    });
  }
};

// Optional authentication (guest checkout allowed)
const optionalAuth = async (req, res, next) => {
  try {
    const cookie = req.headers.cookie;

    if (!cookie) {
      req.user = null;
      return next();
    }

    const user = await getSessionUser(cookie);

    if (!user?.id) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired session",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("Optional Authentication Error:", error);

    res.status(500).json({
      success: false,
      message: "Authentication verification failed",
    });
  }
};

module.exports = verifyAuth;
module.exports.optionalAuth = optionalAuth;
