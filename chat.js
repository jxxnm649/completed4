import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

const chatMessages = document.getElementById("chatMessages");
const chatReplyForm = document.getElementById("chatReplyForm");
const chatInput = document.getElementById("chatInput");
const chatSendBtn = document.getElementById("chatSendBtn");

let currentUser = null;

function escapeHtml(str) {
  if (typeof str !== "string") return str;
  return str.replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[m]);
}

function formatTime(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function renderMessages(messages) {

  if (!messages.length) {
    chatMessages.innerHTML = `<div class="chat-empty">👋 Say hello! Ask us anything about your order or products.</div>`;
    return;
  }

  chatMessages.innerHTML = messages.map((m) => {
    const isMine = m.sender !== "admin";
    return `
      <div class="chat-bubble-row ${isMine ? "mine" : "theirs"}">
        <div class="chat-bubble">
          <div>${escapeHtml(m.text || "")}</div>
          <div class="chat-bubble-time">${formatTime(m.createdAt)}</div>
        </div>
      </div>
    `;
  }).join("");

  chatMessages.scrollTop = chatMessages.scrollHeight;

}

function listenForMessages(uid) {
  const q = query(collection(db, "chats", uid, "messages"), orderBy("createdAt", "asc"));
  onSnapshot(q, (snapshot) => {
    const messages = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderMessages(messages);
  }, (error) => {
    console.error("Chat listen error:", error);
    chatMessages.innerHTML = `<div class="chat-empty">❌ Unable to load chat.</div>`;
  });
}

async function ensureChatDoc(user) {

  const chatRef = doc(db, "chats", user.uid);
  const chatSnap = await getDoc(chatRef);

  if (!chatSnap.exists()) {
    await setDoc(chatRef, {
      userId: user.uid,
      customerName: user.displayName || user.email || "Customer",
      lastMessage: "",
      lastMessageAt: serverTimestamp(),
      status: "Open",
      createdAt: serverTimestamp()
    });
  }

}

chatReplyForm.addEventListener("submit", async (e) => {

  e.preventDefault();

  const text = chatInput.value.trim();
  if (!text || !currentUser) return;

  chatSendBtn.disabled = true;

  try {

    await ensureChatDoc(currentUser);

    await addDoc(collection(db, "chats", currentUser.uid, "messages"), {
      sender: "user",
      text,
      createdAt: serverTimestamp()
    });

    await updateDoc(doc(db, "chats", currentUser.uid), {
      lastMessage: text,
      lastMessageAt: serverTimestamp(),
      status: "Open"
    });

    chatInput.value = "";

  } catch (error) {
    console.error("Send message error:", error);
    alert(error.message || "Failed to send message.");
  } finally {
    chatSendBtn.disabled = false;
  }

});

onAuthStateChanged(auth, async (user) => {

  if (!user) {
    window.location.href = "login.html";
    return;
  }

  currentUser = user;

  try {
    await ensureChatDoc(user);
    listenForMessages(user.uid);
  } catch (error) {
    console.error("Chat init error:", error);
    chatMessages.innerHTML = `<div class="chat-empty">❌ Unable to load chat.</div>`;
  }

});
