/**
 * PARTTIME JOB PLATFORM - ADMIN DASHBOARD & MODERATION
 */

const Admin = {
  async loadDashboard() {
    try {
      await this.loadStats();
      await this.loadUsers();
      await this.loadOwnerVerifications();
      await this.loadJobs();
      await this.loadReports();
    } catch (err) {
      console.error('Error loading admin dashboard:', err);
    }
  },

  async loadStats() {
    try {
      const stats = await API.admin.getDashboardStats();
      document.getElementById('adStatStudents').innerText = stats.totalStudentsCount || 0;
      document.getElementById('adStatOwners').innerText = stats.totalOwnersCount || 0;
      document.getElementById('adStatVerifiedOwners').innerText = stats.verifiedOwnersCount || 0;
      document.getElementById('adStatActiveJobs').innerText = stats.totalActiveJobsCount || 0;
      document.getElementById('adStatCompletedJobs').innerText = stats.totalCompletedJobsCount || 0;
      document.getElementById('adStatApplications').innerText = stats.totalApplicationsCount || 0;
      document.getElementById('adStatDisputes').innerText = stats.pendingDisputesCount || 0;
      document.getElementById('adStatSuspended').innerText = stats.suspendedUsersCount || 0;
      document.getElementById('adStatPayout').innerText = '₹' + (stats.totalPlatformPayout || 0).toLocaleString();
    } catch (e) {
      console.warn('Failed to load admin stats', e);
    }
  },

  async loadUsers() {
    const container = document.getElementById('adUsersList');
    if (!container) return;

    try {
      container.innerHTML = '<tr><td colspan="7" class="text-center p-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Loading users...</td></tr>';
      const users = await API.admin.getUsers();

      if (!users || users.length === 0) {
        container.innerHTML = '<tr><td colspan="7" class="text-center p-4 text-muted">No users found.</td></tr>';
        return;
      }

      container.innerHTML = users.map(u => `
        <tr>
          <td>
            <div class="fw-bold">${App.escapeHtml(u.fullName)}</div>
            <small class="text-muted">${App.escapeHtml(u.email)}</small>
          </td>
          <td><a href="tel:${u.phone}">${u.phone}</a></td>
          <td>
            ${u.role === 'ROLE_ADMIN' ? '<span class="badge bg-danger">ADMIN</span>' :
              u.role === 'ROLE_OWNER' ? '<span class="badge bg-primary">OWNER</span>' :
              '<span class="badge bg-success">STUDENT</span>'}
          </td>
          <td>
            ${u.role === 'ROLE_OWNER' ? `<strong>${App.escapeHtml(u.cateringName || 'Catering')}</strong>` :
              u.role === 'ROLE_STUDENT' ? `<span>${App.escapeHtml(u.collegeName || 'College')}</span>` : 'Platform Admin'}
          </td>
          <td>
            ${u.suspended ? '<span class="badge bg-danger">Suspended</span>' : '<span class="badge bg-success">Active</span>'}
          </td>
          <td class="small text-muted">${App.formatDate(u.createdAt)}</td>
          <td>
            ${u.role !== 'ROLE_ADMIN' ? `
              <button class="btn btn-sm ${u.suspended ? 'btn-success' : 'btn-outline-danger'}" onclick="Admin.toggleUserSuspension(${u.id}, ${!u.suspended})">
                ${u.suspended ? '<i class="bi bi-unlock-fill me-1"></i>Reactivate' : '<i class="bi bi-slash-circle me-1"></i>Suspend'}
              </button>
            ` : '<span class="text-muted small">Protected</span>'}
          </td>
        </tr>
      `).join('');
    } catch (err) {
      container.innerHTML = `<tr><td colspan="7" class="text-center p-3 text-danger">Failed to load users: ${err.message}</td></tr>`;
    }
  },

  async loadOwnerVerifications() {
    const container = document.getElementById('adOwnersList');
    if (!container) return;

    try {
      container.innerHTML = '<tr><td colspan="7" class="text-center p-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Loading owners...</td></tr>';
      const owners = await API.admin.getOwners();

      if (!owners || owners.length === 0) {
        container.innerHTML = '<tr><td colspan="7" class="text-center p-4 text-muted">No owners found.</td></tr>';
        return;
      }

      container.innerHTML = owners.map(o => `
        <tr>
          <td>
            <div class="fw-bold">${App.escapeHtml(o.cateringName)}</div>
            <small class="text-muted">Owner: ${App.escapeHtml(o.fullName)} (${App.escapeHtml(o.email)})</small>
          </td>
          <td>${App.escapeHtml(o.businessPhone || o.phone || 'N/A')}</td>
          <td><small class="text-muted">${App.escapeHtml(o.businessAddress || 'Bangalore')}</small></td>
          <td class="text-center fw-bold">${o.totalJobsPosted}</td>
          <td>
            ${o.verified ? '<span class="verified-badge"><i class="bi bi-patch-check-fill"></i> VERIFIED</span>' :
              '<span class="unverified-badge"><i class="bi bi-hourglass-split"></i> PENDING</span>'}
          </td>
          <td class="small text-muted">${o.verifiedAt ? App.formatDate(o.verifiedAt) : 'Not Verified'}</td>
          <td>
            <button class="btn btn-sm ${o.verified ? 'btn-outline-warning' : 'btn-success'}" onclick="Admin.toggleOwnerVerification(${o.id}, ${!o.verified})">
              ${o.verified ? '<i class="bi bi-x-circle me-1"></i>Revoke Badge' : '<i class="bi bi-patch-check-fill me-1"></i>Verify Owner'}
            </button>
          </td>
        </tr>
      `).join('');
    } catch (err) {
      container.innerHTML = `<tr><td colspan="7" class="text-center p-3 text-danger">Failed to load owners</td></tr>`;
    }
  },

  async loadJobs() {
    const container = document.getElementById('adJobsList');
    if (!container) return;

    try {
      container.innerHTML = '<tr><td colspan="7" class="text-center p-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Loading jobs...</td></tr>';
      const jobs = await API.admin.getAllJobs();

      if (!jobs || jobs.length === 0) {
        container.innerHTML = '<tr><td colspan="7" class="text-center p-4 text-muted">No jobs posted yet.</td></tr>';
        return;
      }

      container.innerHTML = jobs.map(j => `
        <tr>
          <td>
            <div class="fw-bold">${App.escapeHtml(j.title)}</div>
            <small class="text-muted">By: ${App.escapeHtml(j.cateringName)}</small>
          </td>
          <td><span class="badge bg-light text-dark border">${j.workTypeDisplayName || j.workType}</span></td>
          <td>📍 ${App.escapeHtml(j.workArea)}</td>
          <td>${App.formatDate(j.jobDate)}</td>
          <td class="fw-bold text-success">₹${j.paymentAmount}</td>
          <td>
            ${j.status === 'OPEN' ? '<span class="badge bg-success">OPEN</span>' :
              j.status === 'FILLED' ? '<span class="badge bg-warning text-dark">FILLED</span>' :
              j.status === 'COMPLETED' ? '<span class="badge bg-primary">COMPLETED</span>' :
              '<span class="badge bg-secondary">CANCELLED</span>'}
          </td>
          <td>
            <div class="btn-group btn-group-sm">
              <button class="btn btn-outline-primary" onclick="App.viewJobDetails(${j.id})"><i class="bi bi-eye"></i></button>
              ${j.status !== 'CANCELLED' ? `
                <button class="btn btn-outline-danger" onclick="Admin.deleteJob(${j.id})"><i class="bi bi-trash"></i></button>
              ` : ''}
            </div>
          </td>
        </tr>
      `).join('');
    } catch (err) {
      container.innerHTML = `<tr><td colspan="7" class="text-center p-3 text-danger">Failed to load jobs</td></tr>`;
    }
  },

  async loadReports() {
    const container = document.getElementById('adReportsList');
    if (!container) return;

    try {
      container.innerHTML = '<tr><td colspan="7" class="text-center p-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Loading disputes & reports...</td></tr>';
      const reports = await API.admin.getAllReports();

      if (!reports || reports.length === 0) {
        container.innerHTML = '<tr><td colspan="7" class="text-center p-4 text-muted">No reports or disputes filed. Platform is running smoothly!</td></tr>';
        return;
      }

      container.innerHTML = reports.map(r => `
        <tr>
          <td>
            <span class="badge bg-danger-subtle text-danger border border-danger-subtle fw-bold">${r.reportTypeDisplayName || r.reportType}</span>
            <div class="small text-muted mt-1">${App.formatTimeAgo(r.createdAt)}</div>
          </td>
          <td>
            <div class="fw-bold">${App.escapeHtml(r.reporterName)}</div>
            <small class="text-muted">${App.escapeHtml(r.reporterEmail)}</small>
          </td>
          <td>
            <div class="fw-bold">${App.escapeHtml(r.targetUserName || 'N/A')}</div>
            <small class="text-muted">${App.escapeHtml(r.targetCateringName || r.targetUserEmail || '')}</small>
          </td>
          <td>
            <div>${App.escapeHtml(r.description)}</div>
            ${r.expectedAmount ? `<div class="small text-muted mt-1">Expected: <strong>₹${r.expectedAmount}</strong> | Received: <strong>₹${r.receivedAmount || 0}</strong></div>` : ''}
            ${r.evidenceNotes ? `<div class="small text-info mt-1"><em>Evidence: "${App.escapeHtml(r.evidenceNotes)}"</em></div>` : ''}
          </td>
          <td>
            ${r.status === 'RESOLVED' ? '<span class="badge bg-success">RESOLVED</span>' :
              r.status === 'DISMISSED' ? '<span class="badge bg-secondary">DISMISSED</span>' :
              '<span class="badge bg-warning">PENDING</span>'}
          </td>
          <td><small class="text-muted">${r.adminRemarks ? App.escapeHtml(r.adminRemarks) : 'No remarks yet'}</small></td>
          <td>
            ${r.status === 'PENDING' || r.status === 'UNDER_REVIEW' ? `
              <button class="btn btn-sm btn-primary-custom" onclick="Admin.openResolveReportModal(${r.id}, '${App.escapeHtml(r.reportTypeDisplayName)}')">
                <i class="bi bi-hammer me-1"></i>Resolve
              </button>
            ` : '<span class="text-muted small">Closed</span>'}
          </td>
        </tr>
      `).join('');
    } catch (err) {
      container.innerHTML = `<tr><td colspan="7" class="text-center p-3 text-danger">Failed to load reports</td></tr>`;
    }
  },

  async toggleOwnerVerification(ownerId, verify) {
    try {
      await API.admin.verifyOwner(ownerId, verify);
      App.showToast(verify ? 'Owner verified! Badge granted.' : 'Verification revoked.', 'success');
      await this.loadOwnerVerifications();
      await this.loadStats();
    } catch (err) {
      App.showToast(err.message || 'Failed to update verification', 'danger');
    }
  },

  async toggleUserSuspension(userId, suspend) {
    const reason = prompt(suspend ? 'Enter reason for suspending user:' : 'Enter reason for reactivating user:', 'Terms of service moderation');
    if (reason === null) return;

    try {
      await API.admin.setUserSuspension(userId, suspend, reason);
      App.showToast(suspend ? 'User suspended' : 'User reactivated', 'info');
      await this.loadUsers();
      await this.loadStats();
    } catch (err) {
      App.showToast(err.message || 'Failed to update suspension', 'danger');
    }
  },

  async deleteJob(jobId) {
    const reason = prompt('Enter moderation reason for deleting/cancelling this job:', 'Policy violation / Inaccurate listing');
    if (reason === null) return;

    try {
      await API.admin.deleteJob(jobId, reason);
      App.showToast('Job removed by admin moderation', 'success');
      await this.loadJobs();
      await this.loadStats();
    } catch (err) {
      App.showToast(err.message || 'Failed to remove job', 'danger');
    }
  },

  openResolveReportModal(reportId, reportType) {
    document.getElementById('resolveReportId').value = reportId;
    document.getElementById('resolveReportTitle').innerText = reportType;
    document.getElementById('resolveAdminRemarks').value = '';
    const modal = new bootstrap.Modal(document.getElementById('resolveReportModal'));
    modal.show();
  },

  async submitResolveReport(e) {
    e.preventDefault();
    const reportId = document.getElementById('resolveReportId').value;
    const status = document.getElementById('resolveStatusSelect').value;
    const adminRemarks = document.getElementById('resolveAdminRemarks').value.trim();
    const btn = document.getElementById('resolveReportSubmitBtn');

    if (!adminRemarks) {
      App.showToast('Please enter admin resolution remarks', 'warning');
      return;
    }

    try {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Resolving...';

      await API.admin.resolveReport(reportId, status, adminRemarks);
      App.showToast('Dispute resolved successfully! Parties notified.', 'success');

      const modalEl = document.getElementById('resolveReportModal');
      const modal = bootstrap.Modal.getInstance(modalEl);
      if (modal) modal.hide();

      await this.loadReports();
      await this.loadStats();
    } catch (err) {
      App.showToast(err.message || 'Failed to resolve dispute', 'danger');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-check2-circle me-2"></i>Submit Resolution';
    }
  }
};
