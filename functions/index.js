const functions = require("firebase-functions");
const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp();
const db = admin.firestore();

const PADDLE_WEBHOOK_SECRET = functions.config().paddle.webhook_secret;

// Verifies that a webhook actually came from Paddle, not an impersonator
function verifyPaddleSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(";").map((p) => p.split("="))
  );
  const { ts, h1 } = parts;
  if (!ts || !h1) return false;
  const signedPayload = `${ts}:${rawBody}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");
  return expected === h1;
}

// Called automatically by Paddle when a payment event happens
exports.paddleWebhook = functions.https.onRequest(async (req, res) => {
  const signature = req.headers["paddle-signature"];
  const rawBody = req.rawBody.toString();

  if (!verifyPaddleSignature(rawBody, signature, PADDLE_WEBHOOK_SECRET)) {
    console.error("Invalid Paddle signature");
    return res.status(400).send("Invalid signature");
  }

  const event = req.body;

  if (event.event_type === "transaction.completed") {
    const uid = event.data?.custom_data?.uid;
    const customerId = event.data?.customer_id;
    if (uid) {
      await db.collection("users").doc(uid).set(
        { plan: "paid", paddleCustomerId: customerId },
        { merge: true }
      );
    }
  }

  if (event.event_type === "subscription.canceled") {
    const customerId = event.data?.customer_id;
    const snap = await db
      .collection("users")
      .where("paddleCustomerId", "==", customerId)
      .get();
    snap.forEach((doc) => doc.ref.set({ plan: "free" }, { merge: true }));
  }

  res.status(200).json({ received: true });
});
