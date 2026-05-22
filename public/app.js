document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) {
    return;
  }

  const message = form.dataset.confirm;
  if (message && !window.confirm(message)) {
    event.preventDefault();
  }
});

const orderSidebar = document.querySelector("#orderDetailSidebar");

function closeOrderSidebar() {
  if (!orderSidebar) {
    return;
  }
  orderSidebar.classList.remove("is-open");
  orderSidebar.setAttribute("aria-hidden", "true");
  for (const panel of orderSidebar.querySelectorAll(".order-detail-panel")) {
    panel.hidden = true;
  }
}

function openOrderSidebar(orderId) {
  if (!orderSidebar) {
    return;
  }
  let activePanel = null;
  for (const panel of orderSidebar.querySelectorAll(".order-detail-panel")) {
    const isActive = panel.dataset.orderDetail === orderId;
    panel.hidden = !isActive;
    if (isActive) {
      activePanel = panel;
    }
  }
  if (!activePanel) {
    return;
  }
  orderSidebar.classList.add("is-open");
  orderSidebar.setAttribute("aria-hidden", "false");
  orderSidebar.scrollTop = 0;
}

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const orderCard = target.closest("[data-order-target]");
  if (orderCard) {
    openOrderSidebar(orderCard.dataset.orderTarget);
    return;
  }

  if (target.closest("[data-order-sidebar-close]")) {
    closeOrderSidebar();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeOrderSidebar();
  }
});
