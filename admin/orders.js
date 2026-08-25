import { auth, db } from "../firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";

import {
  collection,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

import {
  openModal,
  closeModal,
  showToast
} from "../design-system.js";

import { logAdminAction } from "./audit.js";


const ordersList = document.getElementById("ordersList");
const orderCount = document.getElementById("orderCount");
const orderSearch = document.getElementById("orderSearch");
const orderStatusFilter = document.getElementById("orderStatusFilter");

const orderDetailsModal = document.getElementById("orderDetailsModal");
const orderDetailsCloseBtn = document.getElementById("orderDetailsCloseBtn");
const orderDetailsContent = document.getElementById("orderDetailsContent");

const STATUS_OPTIONS = [
  "Pending", "Confirmed", "Packed", "Shipped",
  "Out for Delivery", "Delivered", "Cancelled"
];

let allOrders = [];
let currentDetailsOrderId = null;


/* =========================
   HELPERS
========================= */

function escapeHtml(str) {
  if (typeof str !== "string") return str;
  return str.replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[m]);
}

function formatDate(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    if (isNaN(d.getTime())) return "Not available";
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) +
      " · " +
      d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "Not available";
  }
}

function statusPillClass(status) {
  if (status === "Cancelled") return "bf-status-danger";
  if (status === "Delivered") return "bf-status-success";
  if (status === "Pending") return "bf-status-pending";
  return "bf-status-progress";
}


/* =========================
   LOAD & RENDER
========================= */

async function loadOrders() {

  try {

    let snapshot;

    try {
      snapshot = await getDocs(
        query(collection(db, "orders"), orderBy("createdAt", "desc"))
      );
    } catch {
      snapshot = await getDocs(collection(db, "orders"));
    }

    allOrders = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data()
    }));

    renderOrderList();

  } catch (error) {

    console.error("Orders loading error:", error);

    ordersList.innerHTML = `
      <div class="bf-card" style="padding:20px;">
        ❌ Unable to load orders.
      </div>
    `;

  }

}

function getFilteredOrders() {

  const term = orderSearch.value.trim().toLowerCase();
  const statusFilter = orderStatusFilter.value;

  return allOrders.filter((order) => {

    const name = (order.customerName || "").toLowerCase();
    const mobile = (order.mobile || "").toLowerCase();
    const idMatch = order.id.toLowerCase().includes(term);

    const matchesTerm = !term || name.includes(term) || mobile.includes(term) || idMatch;
    const matchesStatus = statusFilter === "All Status" || order.status === statusFilter;

    return matchesTerm && matchesStatus;

  });

}

function renderOrderList() {

  const filtered = getFilteredOrders();

  orderCount.textContent = `Total Orders: ${allOrders.length}`;

  if (!filtered.length) {
    ordersList.innerHTML = `
      <div class="bf-card" style="padding:20px;">
        No orders found.
      </div>
    `;
    return;
  }

  ordersList.innerHTML = filtered.map((order) => {

    const total = order.total ?? order.totalPrice ?? 0;
    const itemCount = Array.isArray(order.products) ? order.products.length : 0;

    return `
      <div class="bf-card" style="padding:16px; display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">

        <div>
          <div style="font-weight:700;">
            #${escapeHtml(order.id.slice(0, 8).toUpperCase())}
            &nbsp;·&nbsp;
            ${escapeHtml(order.customerName || "Customer")}
          </div>

          <div style="font-size:13px; opacity:.7; margin-top:2px;">
            ${escapeHtml(order.mobile || "No mobile")} · ${itemCount} item${itemCount === 1 ? "" : "s"} · ₹${escapeHtml(String(total))}
          </div>

          <div style="font-size:12px; opacity:.55; margin-top:2px;">
            ${formatDate(order.createdAt)}
          </div>
        </div>

        <div style="display:flex; align-items:center; gap:10px;">
          <span class="bf-status-pill ${statusPillClass(order.status)}">
            ${escapeHtml(order.status || "Pending")}
          </span>

          <button
            type="button"
            class="bf-btn bf-btn-ghost bf-btn-sm view-order-btn"
            data-id="${escapeHtml(order.id)}">
            View
          </button>
        </div>

      </div>
    `;

  }).join("");

}

if (orderSearch) {
  orderSearch.addEventListener("input", renderOrderList);
}

if (orderStatusFilter) {
  orderStatusFilter.addEventListener("change", renderOrderList);
}


/* =========================
   ORDER DETAILS MODAL
========================= */

function renderOrderDetails(order) {

  const total = order.total ?? order.totalPrice ?? 0;

  const productsHTML = Array.isArray(order.products) && order.products.length
    ? order.products.map((p) => `
        <div style="display:flex; gap:10px; align-items:center; padding:8px 0; border-bottom:1px solid var(--line, #E4DED2);">
          <img
            src="${escapeHtml(p.image || "")}"
            alt="${escapeHtml(p.productName || "")}"
            style="width:50px; height:50px; object-fit:cover; border-radius:8px;">

          <div style="flex:1;">
            <div style="font-weight:600; font-size:13px;">
              ${escapeHtml(p.productName || "Product")}${p.qty > 1 ? ` × ${escapeHtml(String(p.qty))}` : ""}
            </div>
            ${(p.selectedSize || p.selectedColour) ? `
              <div style="font-size:12px; opacity:.65;">
                ${escapeHtml([p.selectedSize, p.selectedColour].filter(Boolean).join(", "))}
              </div>
            ` : ""}
          </div>

          <div style="font-weight:600; font-size:13px;">
            ₹${escapeHtml(String(p.price ?? ""))}
          </div>
        </div>
      `).join("")
    : `<p style="opacity:.6;">No item details available.</p>`;

  orderDetailsContent.innerHTML = `

    <div style="margin-bottom:14px;">
      <div><b>Order ID:</b> #${escapeHtml(order.id.slice(0, 8).toUpperCase())}</div>
      <div><b>Customer:</b> ${escapeHtml(order.customerName || "Customer")}</div>
      <div><b>Mobile:</b> ${escapeHtml(order.mobile || "Not available")}</div>
      <div><b>Address:</b> ${escapeHtml(order.address || "Not available")}</div>
      <div><b>Payment:</b> ${order.paymentMethod === "cod" ? "Cash on Delivery" : "Paid Online"}</div>
      <div><b>Total:</b> ₹${escapeHtml(String(total))}</div>
      <div><b>Placed on:</b> ${formatDate(order.createdAt)}</div>
    </div>

    <h3 style="font-size:14px; margin:16px 0 8px;">🛍️ Items</h3>
    <div style="margin-bottom:16px;">
      ${productsHTML}
    </div>

    <h3 style="font-size:14px; margin:16px 0 8px;">📦 Update Status</h3>

    <div class="bf-field">
      <select id="orderStatusSelect" class="bf-select">
        ${STATUS_OPTIONS.map(s =>
          `<option value="${s}" ${order.status === s ? "selected" : ""}>${s}</option>`
        ).join("")}
      </select>
    </div>

    <button
      type="button"
      id="updateOrderStatusBtn"
      class="bf-btn bf-btn-primary bf-btn-block">
      Update Status
    </button>

  `;

}

if (ordersList) {
  ordersList.addEventListener("click", (e) => {

    const viewBtn = e.target.closest(".view-order-btn");
    if (!viewBtn) return;

    const id = viewBtn.dataset.id;
    const order = allOrders.find(o => o.id === id);
    if (!order) return;

    currentDetailsOrderId = id;
    renderOrderDetails(order);
    openModal("orderDetailsModal");

  });
}

if (orderDetailsCloseBtn) {
  orderDetailsCloseBtn.addEventListener("click", () => {
    closeModal("orderDetailsModal");
  });
}

if (orderDetailsContent) {
  orderDetailsContent.addEventListener("click", async (e) => {

    if (e.target.id !== "updateOrderStatusBtn") return;

    const btn = e.target;
    const select = document.getElementById("orderStatusSelect");
    const newStatus = select.value;

    btn.disabled = true;
    btn.textContent = "Updating...";

    try {

      await updateDoc(doc(db, "orders", currentDetailsOrderId), { status: newStatus });

      await logAdminAction("Updated order status", "Orders", {
        orderId: currentDetailsOrderId,
        newStatus
      });

      const idx = allOrders.findIndex(o => o.id === currentDetailsOrderId);
      if (idx !== -1) {
        allOrders[idx] = { ...allOrders[idx], status: newStatus };
      }

      renderOrderList();
      showToast("Order status updated", "success");
      closeModal("orderDetailsModal");

    } catch (error) {

      console.error("Order status update error:", error);
      showToast(error.message || "Failed to update status.", "danger");

    } finally {

      btn.disabled = false;
      btn.textContent = "Update Status";

    }

  });
}


/* =========================
   APP INIT (ADMIN CHECK)
========================= */

onAuthStateChanged(auth, async (user) => {

  if (!user) {
    window.location.href = "login.html";
    return;
  }

  try {

    const userDoc = await getDoc(doc(db, "users", user.uid));

    if (!userDoc.exists() || userDoc.data().isAdmin !== true) {
      alert("Access Denied ❌");
      window.location.href = "home.html";
      return;
    }

  } catch (error) {
    console.error("Admin check error:", error);
    window.location.href = "home.html";
    return;
  }

  loadOrders();

});
