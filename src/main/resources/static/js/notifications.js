/**
 * PARTTIME JOB PLATFORM - IN-APP NOTIFICATIONS
 */

const Notifications = {
  pollInterval: null,

  init() {
    this.bindEvents();
    if (API.isAuthenticated()) {
      this.fetchUnreadCount();
    }
  },

  bindEvents() {
    const notifBtn = document.getElementById('notifDropdownBtn');
    if (notifBtn) {
      notifBtn.addEventListener('click', () => {
        this.fetchNotifications();
      });
    }

    const markAllReadBtn = document.getElementById('markAllNotifsReadBtn');
    if (markAllReadBtn) {
      markAllReadBtn.addEventListener('click', async () => {
        try {
          await API.notifications.markAllAsRead();
          this.fetchNotifications();
          this.fetchUnreadCount();
        } catch (err) {
          console.error('Failed to mark all read:', err);
        }
      });
    }
  },

  startPolling() {
    this.stopPolling();
    this.fetchUnreadCount();
    this.pollInterval = setInterval(() => {
      this.fetchUnreadCount();
    }, 15000); // Check every 15 seconds
  },

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  },

  async fetchUnreadCount() {
    if (!API.isAuthenticated()) return;
    try {
      const count = await API.notifications.getUnreadCount();
      const badge = document.getElementById('notifBadge');
      if (badge) {
        if (count > 0) {
          badge.innerText = count > 9 ? '9+' : count;
          badge.classList.remove('d-none');
        } else {
          badge.classList.add('d-none');
        }
      }
    } catch (e) {
      console.warn('Failed to fetch unread notifications count');
    }
  },

  async fetchNotifications() {
    const listEl = document.getElementById('notifList');
    if (!listEl) return;

    try {
      listEl.innerHTML = '<div class="p-3 text-center text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Loading notifications...</div>';
      const items = await API.notifications.getMyNotifications();

      if (items?.some(item => item.type === 'REPORT_WITHDRAWN') && typeof Owner !== 'undefined') {
        Owner.loadComplaints();
      }

      if (!items || items.length === 0) {
        listEl.innerHTML = '<div class="p-4 text-center text-muted"><i class="bi bi-bell-slash fs-3 d-block mb-2"></i>No notifications yet</div>';
        return;
      }

      listEl.innerHTML = items.map(n => `
        <div class="notif-item ${!n.isRead ? 'unread' : ''}" onclick="Notifications.handleNotifClick(${n.id}, '${n.type}')">
          <div class="d-flex justify-content-between align-items-start mb-1">
            <h6 class="mb-0 fw-bold ${!n.isRead ? 'text-primary' : 'text-dark'}" style="font-size: 0.9rem;">${App.escapeHtml(n.title)}</h6>
            <small class="text-muted" style="font-size: 0.75rem;">${App.formatTimeAgo(n.createdAt)}</small>
          </div>
          <p class="mb-1 text-muted" style="font-size: 0.825rem; line-height: 1.35;">${App.escapeHtml(n.message)}</p>
        </div>
      `).join('');
    } catch (err) {
      listEl.innerHTML = `<div class="p-3 text-center text-danger">Failed to load notifications: ${err.message}</div>`;
    }
  },

  async handleNotifClick(id, type) {
    try {
      await API.notifications.markAsRead(id);
      this.fetchUnreadCount();
      this.fetchNotifications();
    } catch (e) {
      console.warn('Failed to mark notification read', e);
    }
  }
};
