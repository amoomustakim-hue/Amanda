# NovaMart: Mock E-Commerce Website

This is a polished, static mock e-commerce storefront created strictly to generate mock business events for testing the **Amanda** AI prioritization pipeline. 

## 🎯 What the mock website is
It is a static HTML/CSS/JS frontend styled as a premium modern brand ("NovaMart"). It does not require a real backend or database. Instead, it simulates realistic customer interactions (like abandoned checkouts and bulk inquiries) and stores those events locally in the browser. 

## 🚀 How to run it
You do not need to install any frameworks or dependencies.
Simply double-click the file to open it in your browser:
`mock-website/index.html`

*(Optional: If you use VS Code, you can use the "Live Server" extension to serve the files, but it is entirely optional).*

## 📡 What events it simulates
The website's **Demo Business Events** section can generate the following payloads:
- `new_order`
- `abandoned_checkout`
- `failed_payment`
- `delivery_complaint`
- `refund_request`
- `bulk_order_inquiry`
- `high_value_inquiry`

Each event follows a strict JSON schema containing `customerName`, `email`, `value` (in NGN), `product`, `message`, `priority`, and a timestamp.

## 🔗 How it will later connect to Amanda
Currently, events are saved directly to `localStorage` (`novamart_events`) and rendered in the "Recent Website Events" panel. 

In `app.js`, there is a commented-out `fetch` block inside the `dispatchEvent()` function. Once Amanda's API is ready, you simply uncomment this block to automatically `POST` events directly to Amanda:

```javascript
fetch("http://localhost:3000/api/connectors/website/events", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-amanda-website-secret": "demo-secret"
  },
  body: JSON.stringify(eventPayload)
})