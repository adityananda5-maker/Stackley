const functions = require("firebase-functions");
const admin = require("firebase-admin");
const Stripe = require("stripe");

admin.initializeApp();
const db = admin.firestore();
const stripe = Stripe(functions.config().stripe.secret);
const PRICE_ID = functions.config().stripe.price_id;

// Called from the frontend when the user clicks "Upgrade"
exports.createCheckoutSession = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "You must be logged in.");
  }
  const uid = context.auth.uid;
  const email = context.auth.token.email;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    customer_email: email,
    client_reference_id: uid,
    line_items: [{ price: PRICE_ID, quantity: 1 }],
    success_url: data.successUrl,
    cancel_url: data.cancelUrl,
  });

  return { url: session.url };
});

// Called automatically by Stripe when a payment event happens
exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.rawBody,
      sig,
      functions.config().stripe.webhook_secret
    );
  } catch (err) {
    console.error("Webhook signature failed", err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const uid = session.client_reference_id;
    if (uid) {
      await db.collection("users").doc(uid).set(
        { plan: "paid", stripeCustomerId: session.customer },
        { merge: true }
      );
    }
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object;
    const snap = await db.collection("users")
      .where("stripeCustomerId", "==", sub.customer).get();
    snap.forEach(doc => doc.ref.set({ plan: "free" }, { merge: true }));
  }

  res.json({ received: true });
});
