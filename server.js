const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 3000);
const ADMIN_KEY = process.env.GENETIC_ADMIN_KEY || "change-me";
const TELEGRAM_TOKEN = process.env.GENETIC_TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.GENETIC_TELEGRAM_CHAT_ID || "";

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const DATA = path.join(ROOT, "data");
const ORDERS_FILE = path.join(DATA, "orders.json");
fs.mkdirSync(DATA, { recursive: true });
if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, "[]");

const products = [
  { id: 1, name: "Zip Hoodie — Deep Plum", color: "Deep Plum", price: 50, image: "/images/plum.jpg" },
  { id: 2, name: "Zip Hoodie — Black", color: "Black", price: 50, image: "/images/black.jpg" },
  { id: 3, name: "Crewneck — Dark Brown", color: "Dark Brown", price: 50, image: "/images/brown.jpg" },
  { id: 4, name: "Zip Hoodie — Heather Grey", color: "Heather Grey", price: 50, image: "/images/grey.jpg" }
];

function readOrders() {
  try { return JSON.parse(fs.readFileSync(ORDERS_FILE, "utf8")); }
  catch { return []; }
}
function writeOrders(orders) {
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
}
function sendJson(res, status, body) {
  const out = JSON.stringify(body);
  res.writeHead(status, {"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});
  res.end(out);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); } catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}
function clean(v, max=500) {
  return String(v ?? "").trim().slice(0,max);
}
function telegramMessage(order) {
  const items = order.items.map(i => `• ${i.name} x${i.quantity} — $${(i.price*i.quantity).toFixed(2)}`).join("\n");
  return `🛍️ *GENETIC — NIEUWE BESTELLING*\n\nOrder: ${order.id}\nKlant: ${order.customer.name}\nTelefoon: ${order.customer.phone}\nAdres: ${order.customer.address}\n\n${items}\n\nTotaal: $${order.total.toFixed(2)}\n70% voorschot: $${order.deposit.toFixed(2)}\nRestant: $${order.balance.toFixed(2)}\nBetaling: Bankovermaking\n\nTijd: ${order.createdAt}`;
}
async function sendTelegram(order) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return { sent:false, reason:"not_configured" };
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    const response = await fetch(url, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: telegramMessage(order),
        parse_mode:"Markdown"
      })
    });
    return { sent: response.ok };
  } catch {
    return { sent:false, reason:"network_error" };
  }
}

async function api(req, res, url) {
  if (url.pathname === "/api/products" && req.method === "GET") {
    return sendJson(res, 200, products);
  }

  if (url.pathname === "/api/orders" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const customer = {
        name: clean(body.name, 100),
        phone: clean(body.phone, 60),
        address: clean(body.address, 300),
        notes: clean(body.notes, 500)
      };
      if (!customer.name || !customer.phone || !customer.address) {
        return sendJson(res, 400, {error:"Name, telefoon en adres zijn verplicht."});
      }
      if (body.country !== "Suriname") {
        return sendJson(res, 400, {error:"GENETIC verkoopt momenteel alleen in Suriname."});
      }
      if (!Array.isArray(body.items) || !body.items.length) {
        return sendJson(res, 400, {error:"Je winkelwagen is leeg."});
      }

      const items = [];
      for (const raw of body.items) {
        const product = products.find(p => p.id === Number(raw.id));
        const quantity = Math.max(1, Math.min(20, Number(raw.quantity) || 1));
        if (!product) continue;
        items.push({
          id: product.id,
          name: product.name,
          price: product.price,
          quantity
        });
      }
      if (!items.length) return sendJson(res, 400, {error:"Geen geldige producten."});

      const total = Number(items.reduce((sum, i) => sum + i.price * i.quantity, 0).toFixed(2));
      const deposit = Number((total * 0.70).toFixed(2));
      const balance = Number((total - deposit).toFixed(2));

      const order = {
        id: "GEN-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomBytes(2).toString("hex").toUpperCase(),
        status: "pending_deposit",
        country: "Suriname",
        paymentMethod: "Bankovermaking",
        depositPercent: 70,
        customer,
        items,
        total,
        deposit,
        balance,
        createdAt: new Date().toISOString()
      };

      const orders = readOrders();
      orders.unshift(order);
      writeOrders(orders);

      const notification = await sendTelegram(order);
      return sendJson(res, 201, {ok:true, order, notification});
    } catch (e) {
      return sendJson(res, 500, {error:"Kon bestelling niet verwerken."});
    }
  }

  if (url.pathname === "/api/admin/orders" && req.method === "GET") {
    if (url.searchParams.get("key") !== ADMIN_KEY) return sendJson(res, 401, {error:"Unauthorized"});
    return sendJson(res, 200, readOrders());
  }

  if (url.pathname === "/api/admin/orders" && req.method === "PATCH") {
    if (url.searchParams.get("key") !== ADMIN_KEY) return sendJson(res, 401, {error:"Unauthorized"});
    try {
      const body = await readBody(req);
      const orders = readOrders();
      const order = orders.find(o => o.id === body.id);
      if (!order) return sendJson(res, 404, {error:"Order not found"});
      const allowed = ["pending_deposit","deposit_received","ready_for_delivery","completed","cancelled"];
      if (!allowed.includes(body.status)) return sendJson(res, 400, {error:"Invalid status"});
      order.status = body.status;
      order.updatedAt = new Date().toISOString();
      writeOrders(orders);
      return sendJson(res, 200, order);
    } catch {
      return sendJson(res, 400, {error:"Invalid request"});
    }
  }

  return sendJson(res, 404, {error:"Not found"});
}

const mime = {
  ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8",
  ".js":"application/javascript; charset=utf-8", ".jpg":"image/jpeg",
  ".jpeg":"image/jpeg", ".png":"image/png", ".svg":"image/svg+xml",
  ".ico":"image/x-icon", ".json":"application/json"
};

const server = http.createServer(async (req,res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) return api(req,res,url);

  let filePath = path.normalize(path.join(PUBLIC, url.pathname === "/" ? "index.html" : url.pathname));
  if (!filePath.startsWith(PUBLIC)) return sendJson(res,403,{error:"Forbidden"});
  fs.stat(filePath, (err,stat) => {
    if (err || !stat.isFile()) {
      filePath = path.join(PUBLIC,"index.html");
    }
    fs.readFile(filePath,(readErr,data)=>{
      if (readErr) return sendJson(res,500,{error:"Server error"});
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200,{"Content-Type":mime[ext] || "application/octet-stream"});
      res.end(data);
    });
  });
});

server.listen(PORT, () => {
  console.log(`GENETIC running at http://localhost:${PORT}`);
  console.log(`Admin dashboard: http://localhost:${PORT}/admin.html`);
  console.log(`Admin key: ${ADMIN_KEY}`);
});
