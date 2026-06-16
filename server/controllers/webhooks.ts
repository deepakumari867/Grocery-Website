import { Request, Response } from "express";
import Stripe from "stripe";
import { prisma } from "../config/prisma.js";
import { inngest } from "../inngest/index.js";

const stripeKey = process.env.STRIPE_SECRET_KEY;
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

// Stripe tabhi initialize hoga jab key milegi
const stripe = stripeKey ? new Stripe(stripeKey) : null;

export const stripeWebhook = async (request: Request, response: Response) => {
  if (!stripe || !endpointSecret) {
    return response.status(500).json({
      message: "Stripe is not configured. Please add STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in .env",
    });
  }

  let event;

  const signature = request.headers["stripe-signature"];

  try {
    event = stripe.webhooks.constructEvent(
      request.body,
      signature as string,
      endpointSecret
    );
  } catch (err: any) {
    console.log("⚠️ Webhook signature verification failed.", err.message);
    return response.sendStatus(400);
  }

  switch (event.type) {
    case "payment_intent.succeeded": {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      const paymentIntentId = paymentIntent.id;

      const session = await stripe.checkout.sessions.list({
        payment_intent: paymentIntentId,
      });

      const { orderId } = session.data[0].metadata as any;

      const paidOrder = await prisma.order.update({
        where: { id: orderId },
        data: { isPaid: true },
      });

      const orderItems = Array.isArray(paidOrder.items)
        ? paidOrder.items
        : [];

      for (const item of orderItems) {
        await prisma.product.update({
          where: { id: item.product },
          data: {
            stock: {
              decrement: item.quantity,
            },
          },
        });
      }

      await inngest.send({
        name: "order/placed",
        data: { orderId },
      });

      break;
    }

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  response.json({ received: true });
};