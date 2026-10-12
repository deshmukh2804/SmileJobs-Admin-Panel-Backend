// ============================================================================
// SmileJobs Admin Portal - Service-to-Service (S2S) Authentication Middleware
// Path: backend/src/middleware/serviceAuth.js
// ----------------------------------------------------------------------------
// PURPOSE:
//   Authenticates requests from TRUSTED EXTERNAL SERVERS (e.g., the Recruiter
//   Website backend) that need to push data into the Admin Portal database
//   WITHOUT a user JWT token.
//
// USE CASE:
//   The Recruiter Website processes a Razorpay payment and must notify the
//   Admin Portal to record the transaction. It cannot use /admin/login JWT
//   because it's a server, not a user. Instead, it sends a shared secret
//   via the "X-Service-API-Key" HTTP header, which this middleware validates.
//
// SECURITY:
//   - The secret key is stored ONLY in process.env (never committed to Git)
//   - Uses constant-time string comparison to prevent timing attacks
//   - Logs all unauthorized access attempts for audit review
//   - Case-insensitive header lookup (HTTP headers are case-insensitive)
//   - Supports both production and development fallback modes
//
// WHY REQUIRED:
//   Without this file, the POST /api/v1/payment-dashboard/service/transactions
//   endpoint would either:
//     (a) Be publicly open → anyone could inject fake payment records, OR
//     (b) Require admin JWT → recruiter server has no way to obtain one
//   This middleware is the industry-standard solution (used by Stripe,
//   Twilio, SendGrid, Razorpay webhooks, etc.) for machine-to-machine auth.
// ============================================================================

const crypto = require("crypto");

// ----------------------------------------------------------------------------
// Constant-time string comparison helper
// Prevents timing attacks where an attacker could guess the key character
// by character based on how long the comparison takes.
// ----------------------------------------------------------------------------
const safeCompare = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch (err) {
    return false;
  }
};

// ----------------------------------------------------------------------------
// Extract Service API Key from request headers
// HTTP headers are case-insensitive per RFC 7230, but Express normalizes
// them to lowercase. We check multiple variants to be defensive.
// ----------------------------------------------------------------------------
const extractServiceKey = (req) => {
  if (!req || !req.headers) return null;

  const h = req.headers;

  // Primary header name (recommended for clients)
  const key =
    h["x-service-api-key"] ||
    h["X-Service-API-Key"] ||
    h["x-service-api-Key"] ||
    h["X-SERVICE-API-KEY"] ||
    h["x_service_api_key"] ||
    null;

  // Fallback: some clients send in Authorization header as "Service <key>"
  if (!key && h.authorization && typeof h.authorization === "string") {
    const parts = h.authorization.trim().split(/\s+/);
    if (parts.length === 2 && parts[0].toLowerCase() === "service") {
      return parts[1];
    }
  }

  if (!key) return null;
  if (typeof key !== "string") return null;
  return key.trim();
};

// ----------------------------------------------------------------------------
// Get the configured secret key from environment variables
// Falls back to a well-known development key if not set (DEV ONLY)
// ----------------------------------------------------------------------------
const getConfiguredServiceKey = () => {
  const envKey = process.env.RECRUITER_SERVICE_API_KEY;

  if (envKey && typeof envKey === "string" && envKey.trim().length > 0) {
    return envKey.trim();
  }

  // Development fallback — logged as warning so devs know to set env var
  const fallback = "cf_default_insecure_dev_key_CHANGE_IN_PRODUCTION_2026";

  if (process.env.NODE_ENV === "production") {
    console.error(
      "\n[serviceAuth] CRITICAL: RECRUITER_SERVICE_API_KEY is NOT SET in production environment!\n" +
        "              All S2S requests will be REJECTED until you add it to backend/.env\n"
    );
    return null; // In production, refuse to use fallback — fail closed
  }

  console.warn(
    "[serviceAuth] WARNING: Using default development key. " +
      "Set RECRUITER_SERVICE_API_KEY in .env for production use."
  );
  return fallback;
};

// ----------------------------------------------------------------------------
// MAIN MIDDLEWARE: requireServiceAuth
// Attach to routes that should only be callable by trusted external servers
// Example: router.post("/service/transactions", requireServiceAuth, handler)
// ----------------------------------------------------------------------------
const requireServiceAuth = (req, res, next) => {
  try {
    const providedKey = extractServiceKey(req);
    const configuredKey = getConfiguredServiceKey();

    // Config problem — no key defined on server side
    if (!configuredKey) {
      console.error(
        `[serviceAuth] REJECTED ${req.method} ${req.originalUrl} — ` +
          `Server has no RECRUITER_SERVICE_API_KEY configured`
      );
      return res.status(503).json({
        success: false,
        message:
          "Service-to-service authentication is not configured on this server. " +
          "Contact the system administrator.",
        error: "SERVICE_AUTH_NOT_CONFIGURED",
      });
    }

    // Client did not send a key at all
    if (!providedKey) {
      const ip = req.ip || req.connection?.remoteAddress || "unknown";
      console.warn(
        `[serviceAuth] REJECTED ${req.method} ${req.originalUrl} — ` +
          `No X-Service-API-Key header provided (IP: ${ip})`
      );
      return res.status(401).json({
        success: false,
        message:
          "Missing service authentication header. " +
          "Include 'X-Service-API-Key' in your request headers.",
        error: "SERVICE_AUTH_HEADER_MISSING",
      });
    }

    // Key mismatch — use timing-safe comparison
    if (!safeCompare(providedKey, configuredKey)) {
      const ip = req.ip || req.connection?.remoteAddress || "unknown";
      const ua = req.headers["user-agent"] || "unknown";
      console.warn(
        `[serviceAuth] REJECTED ${req.method} ${req.originalUrl} — ` +
          `Invalid service API key (IP: ${ip}, UA: ${ua.substring(0, 80)})`
      );
      return res.status(403).json({
        success: false,
        message:
          "Invalid service authentication key. " +
          "Verify the X-Service-API-Key value matches the admin portal configuration.",
        error: "SERVICE_AUTH_KEY_INVALID",
      });
    }

    // ✅ Authentication succeeded — attach context for downstream handlers
    req.isServiceRequest = true;
    req.serviceAuth = {
      authenticated: true,
      authenticatedAt: new Date().toISOString(),
      source: "external_service",
      callerName: req.headers["x-service-caller"] || "recruiter_website",
      ip: req.ip || req.connection?.remoteAddress || "unknown",
    };

    // Log successful S2S call for audit trail
    if (process.env.NODE_ENV !== "production" || process.env.LOG_SERVICE_AUTH === "true") {
      console.log(
        `[serviceAuth] ✓ Authenticated ${req.method} ${req.originalUrl} ` +
          `from ${req.serviceAuth.callerName} (IP: ${req.serviceAuth.ip})`
      );
    }

    return next();
  } catch (err) {
    console.error("[serviceAuth] Unexpected error in requireServiceAuth:", err);
    return res.status(500).json({
      success: false,
      message: "Internal error while validating service authentication.",
      error: "SERVICE_AUTH_INTERNAL_ERROR",
    });
  }
};

// ----------------------------------------------------------------------------
// OPTIONAL MIDDLEWARE: allowServiceOrAdmin
// Permits either a valid service API key OR a valid admin JWT.
// Useful for endpoints that both the recruiter website AND admin UI need.
// ----------------------------------------------------------------------------
const allowServiceOrAdmin = (protectMiddleware) => {
  return (req, res, next) => {
    const providedKey = extractServiceKey(req);

    // If service key header is present, use S2S auth path
    if (providedKey) {
      return requireServiceAuth(req, res, next);
    }

    // Otherwise fall back to standard admin JWT auth
    if (typeof protectMiddleware === "function") {
      return protectMiddleware(req, res, next);
    }

    return res.status(401).json({
      success: false,
      message: "Authentication required (either admin JWT or service API key).",
      error: "AUTH_REQUIRED",
    });
  };
};

// ----------------------------------------------------------------------------
// UTILITY: Verify a key programmatically (used by health checks, tests, etc.)
// ----------------------------------------------------------------------------
const verifyServiceKey = (providedKey) => {
  const configured = getConfiguredServiceKey();
  if (!configured || !providedKey) return false;
  return safeCompare(String(providedKey), configured);
};

// ----------------------------------------------------------------------------
// UTILITY: Mask the service key for safe logging / display in admin UI
// Returns something like "cf_d••••••••••••••••••••2026"
// ----------------------------------------------------------------------------
const maskServiceKey = (key) => {
  if (!key || typeof key !== "string" || key.length < 8) {
    return "••••••••";
  }
  const first = key.substring(0, 4);
  const last = key.substring(key.length - 4);
  return `${first}${"•".repeat(Math.max(8, key.length - 8))}${last}`;
};

// ============================================================================
// EXPORTS
// ============================================================================
module.exports = {
  requireServiceAuth,
  allowServiceOrAdmin,
  verifyServiceKey,
  maskServiceKey,
  extractServiceKey,
};