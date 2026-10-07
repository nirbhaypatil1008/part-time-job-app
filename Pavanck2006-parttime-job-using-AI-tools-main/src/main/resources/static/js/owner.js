/**
 * PARTTIME JOB PLATFORM - OWNER DASHBOARD & ACTIONS
 */

const Owner = {
  currentActiveJobId: null,
  _gpsLat: null,
  _gpsLng: null,

  async loadDashboard() {
    try {
      await this.loadProfile();
      await this.loadMyJobs();
      await this.loadClosedJobs();
      await this.loadFullJobs();
      await this.loadPayments();
      await this.loadTransactions();
      await this.loadComplaints();
    } catch (err) {
      console.error('Error loading owner dashboard:', err);
    }
  },

async loadProfile() {
  try {
    const profile = await API.owner.getProfile();

    // ===== Dashboard header (safe) =====
    const cateringEl = document.getElementById('owWelcomeCatering');
    if (cateringEl) cateringEl.innerText = profile.cateringName || 'Catering Name';

    const ownerNameEl = document.getElementById('owOwnerName');
    if (ownerNameEl) ownerNameEl.innerText = profile.fullName || 'Owner';

    const badgeEl = document.getElementById('owVerificationBadge');
    if (badgeEl) {
      if (profile.verified) {
        badgeEl.className = 'verified-badge';
        badgeEl.innerHTML = '<i class="bi bi-patch-check-fill"></i> Verified Catering Business';
        document.getElementById('owUnverifiedAlert')?.classList.add('d-none');
      } else {
        badgeEl.className = 'unverified-badge';
        badgeEl.innerHTML = '<i class="bi bi-hourglass-split"></i> Pending Admin Verification';
        document.getElementById('owUnverifiedAlert')?.classList.remove('d-none');
      }
    }

    // ===== VIEW MODE (Settings → My Profile) =====
    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.innerText = value || '-';
    };

    setText('owViewFullName', profile.fullName);
    setText('owViewEmail', profile.email);
    setText('owViewPhone', profile.phone);
    setText('owViewCateringName', profile.cateringName);
    setText('owViewBizPhone', profile.businessPhone);
    setText('owViewAddress', profile.businessAddress);
    setText('owViewJobsPosted', profile.totalJobsPosted ?? 0);
    setText('owViewVerification', profile.verified ? 'Verified' : (profile.verificationStatus || 'Pending Verification'));

    // Profile photo display
    const photoImg = document.getElementById('owViewPhoto');
    if (photoImg) {        if (profile.profilePhotoUrl) {
        photoImg.src = profile.profilePhotoUrl;
        photoImg.style.display = 'block';
        document.getElementById('owViewPhotoPlaceholder')?.classList.add('d-none');
      } else {
        photoImg.style.display = 'none';
        document.getElementById('owViewPhotoPlaceholder')?.classList.remove('d-none');
      }
    }

    // ===== EDIT FORM (hidden by default) =====
    const setVal = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.value = value || '';
    };

    setVal('owProfFullName', profile.fullName);
    setVal('owProfPhone', profile.phone);
    setVal('owProfCateringName', profile.cateringName);
    setVal('owProfBizPhone', profile.businessPhone);
    setVal('owProfAddress', profile.businessAddress);

  } catch (e) {
    console.warn('Failed to load owner profile', e);
  }
},

async updateProfile(e) {
  e.preventDefault();
  const btn = document.getElementById('owProfSubmitBtn');
  try {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Saving...';

    const payload = {
      fullName: document.getElementById('owProfFullName').value.trim(),
      phone: document.getElementById('owProfPhone').value.trim(),
      cateringName: document.getElementById('owProfCateringName').value.trim(),
      businessAddress: document.getElementById('owProfAddress').value.trim(),
      businessPhone: document.getElementById('owProfBizPhone').value.trim()
    };

    // Handle profile photo upload if selected
    let profilePhotoUrl = null;
    const photoFile = document.getElementById('owProfPhoto').files[0];
    if (photoFile) {
      if (photoFile.size > 5 * 1024 * 1024) {
        App.showToast('Photo too large. Max 5MB.', 'warning');
        return;
      }
      const fd = new FormData();
      fd.append('image', photoFile);
      const uploadRes = await fetch('/api/upload/image', {
        method: 'POST',
        headers: {'Authorization': `Bearer ${API.getToken()}`},
        body: fd
      });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadData.message || 'Failed to upload photo');
      profilePhotoUrl = uploadData.data?.url;
    }
    if (profilePhotoUrl) payload.profilePhotoUrl = profilePhotoUrl;

    await API.owner.updateProfile(payload);
    App.showToast('Catering profile updated successfully!', 'success');
    await this.loadProfile();
    this.exitProfileEditMode();          // ← add this line
  } catch (err) {
    App.showToast(err.message || 'Failed to update profile', 'danger');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-check2-circle me-2"></i>Save Changes';
  }
},

  async loadMyJobs() {
    const container = document.getElementById('owJobsList');
    if (!container) return;

    try {
      container.innerHTML = '<div class="text-center p-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Loading your jobs...</div>';
      const jobs = await API.owner.getMyJobs();

      // Update owner metrics
      let activeJobsCount = 0;
      let completedJobsCount = 0;
      let totalHired = 0;

      if (jobs && jobs.length > 0) {
        jobs.forEach(j => {
          if (j.status === 'OPEN' || j.status === 'FILLED') activeJobsCount++;
          if (j.status === 'COMPLETED') completedJobsCount++;
          totalHired += (j.workersSelected || 0);
        });
      }

      document.getElementById('owStatTotalJobs').innerText = jobs?.length || 0;
      document.getElementById('owStatActiveJobs').innerText = activeJobsCount;
      document.getElementById('owStatHired').innerText = totalHired;
      document.getElementById('owStatCompleted').innerText = completedJobsCount;

      if (!jobs || jobs.length === 0) {
        container.innerHTML = '<div class="text-center p-4 text-muted"><i class="bi bi-briefcase fs-2 d-block mb-2"></i>You have not posted any catering jobs yet. Click "Create New Job" to post!</div>';
        return;
      }

      container.innerHTML = jobs.map(job => {
        let statusBadge = `<span class="badge bg-success">OPEN</span>`;
        if (job.isFull) statusBadge = `<span class="badge bg-warning text-dark"><i class="bi bi-people-fill me-1"></i>FULL (${job.workersSelected}/${job.workersRequired})</span>`;
        if (job.needsDecision) statusBadge = `<span class="badge bg-danger"><i class="bi bi-exclamation-triangle me-1"></i>ACTION REQUIRED</span>`;
        if (job.status === 'REMOVED') statusBadge = `<span class="badge bg-secondary">REMOVED</span>`;
        if (job.status === 'COMPLETED') statusBadge = `<span class="badge bg-primary">COMPLETED</span>`;
        if (job.status === 'CANCELLED') statusBadge = `<span class="badge bg-secondary">CANCELLED</span>`;
        if (job.ownerDecision === 'CONTINUE') statusBadge += ` <span class="badge bg-success-subtle text-success border border-success-subtle">Continued</span>`;

        const isEditable = (job.status === 'OPEN' || job.status === 'FILLED') && job.status !== 'REMOVED';

        return `
          <div class="card mb-3 shadow-sm border-0 border-start border-4 ${job.status === 'COMPLETED' ? 'border-primary' : job.status === 'CANCELLED' ? 'border-secondary' : 'border-success'}">
            <div class="card-body">
              <div class="row align-items-center">
                <div class="col-lg-5 mb-2 mb-lg-0">
                  <div class="d-flex align-items-center gap-2 mb-1">
                    <h5 class="fw-bold mb-0">${App.escapeHtml(job.title)}</h5>
                    ${statusBadge}
                  </div>
                  <div class="text-muted small mb-2">
                    <span class="badge bg-light text-dark border me-1">${job.workTypeDisplayName || job.workType}</span>
                    <span>📍 ${App.escapeHtml(job.workArea)}</span>
                    <span class="ms-2">📅 ${App.formatDate(job.jobDate)} (${App.formatTime(job.startTime)} - ${App.formatTime(job.endTime)})</span>
                  </div>
                  ${job.locationPhotoUrl ? `<div class="mt-2"><img src="${App.escapeHtml(job.locationPhotoUrl)}" alt="Location" class="rounded" style="max-height: 80px; object-fit: cover;" onerror="this.style.display='none'"></div>` : ''}
                  <div class="small text-muted"><i class="bi bi-geo-alt me-1"></i>${App.escapeHtml(job.detailedLocation)}</div>
                  ${job.latitude && job.longitude ? `<div class="small"><a href="https://www.google.com/maps?q=${job.latitude},${job.longitude}" target="_blank" class="text-decoration-none"><i class="bi bi-map me-1"></i>View on Map</a></div>` : ''}
                  ${job.applyDeadline ? `<div class="small ${new Date(job.applyDeadline) < new Date() ? 'text-danger fw-semibold' : 'text-warning'}"><i class="bi bi-clock me-1"></i>Apply by: ${App.formatDate(job.applyDeadline)} ${App.formatTime(job.applyDeadline)}${new Date(job.applyDeadline) < new Date() ? ' (Deadline passed)' : ''}</div>` : ''}
                </div>

                <div class="col-lg-3 mb-2 mb-lg-0 text-lg-center">
                  <div class="fw-bold fs-5 text-success">₹${job.paymentAmount}</div>                    <span class="badge ${job.onSpotPayment ? 'bg-success-subtle text-success' : 'bg-primary-subtle text-primary'} border">${job.paymentTypeDisplayName || 'On-Spot'}</span>
                  <div class="small text-muted mt-1">Hired: <strong>${job.workersSelected}</strong> / ${job.workersRequired} workers</div>
                  ${job.needsDecision ? `<div class="small text-danger fw-semibold mt-1"><i class="bi bi-exclamation-circle me-1"></i>Deadline passed - decision needed</div>` : ''}
                </div>

                <div class="col-lg-4 text-lg-end d-flex flex-wrap gap-1 justify-content-lg-end">
                  ${job.needsDecision ? `
                    <button class="btn btn-sm btn-success" onclick="Owner.makeDecision(${job.id}, 'CONTINUE')">
                      <i class="bi bi-check-circle me-1"></i>Continue
                    </button>
                    <button class="btn btn-sm btn-outline-danger" onclick="Owner.makeDecision(${job.id}, 'REMOVE')">
                      <i class="bi bi-trash me-1"></i>Remove
                    </button>
                  ` : ''}
                  <button class="btn btn-sm btn-primary-custom" onclick="Owner.openApplicantsModal(${job.id}, '${App.escapeHtml(job.title)}')">
                    <i class="bi bi-people-fill me-1"></i>Applicants (${job.applicationCount || 0})
                  </button>
                  
                  ${isEditable ? `
                    <button class="btn btn-sm btn-outline-success" onclick="Owner.completeJob(${job.id})">
                      <i class="bi bi-check2-all me-1"></i>Complete
                    </button>
                  ` : ''}
                  ${job.canDelete ? `
                    <button class="btn btn-sm btn-outline-danger" onclick="Owner.deleteJob(${job.id}, '${App.escapeHtml(job.title)}')">
                      <i class="bi bi-trash me-1"></i>Delete
                    </button>
                  ` : ''}
                </div>
              </div>
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      container.innerHTML = `<div class="text-center text-danger p-3">Failed to load jobs: ${err.message}</div>`;
    }
  },


  async loadClosedJobs() {
    const container = document.getElementById('owClosedJobsList');
    if (!container) return;
    try {
      container.innerHTML = '<div class="text-center p-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Loading closed jobs...</div>';
      const jobs = await API.owner.getClosedJobs();
      if (!jobs || jobs.length === 0) {
        container.innerHTML = '<div class="text-center p-4 text-muted"><i class="bi bi-archive fs-2 d-block mb-2"></i>No closed jobs yet. Jobs appear here after their application deadline passes.</div>';
        return;
      }
      container.innerHTML = jobs.map(job => {
        const applicants = job.applicants || [];
        const accepted = applicants.filter(a => a.status === 'ACCEPTED');
        const pending = applicants.filter(a => a.status === 'APPLIED');
        const rejected = applicants.filter(a => a.status === 'REJECTED');
        return `
          <div class="card mb-3 shadow-sm border-0 border-start border-4 border-secondary">
            <div class="card-body">
              <div class="d-flex justify-content-between align-items-start mb-2">
                <div>
                  <h5 class="fw-bold mb-1">${App.escapeHtml(job.title)}</h5>
                  <div class="text-muted small mb-2">
                    <span class="badge bg-light text-dark border me-1">${job.workTypeDisplayName || job.workType}</span>
                    <span>📍 ${App.escapeHtml(job.workArea)}</span>
                    <span class="ms-2">📅 ${App.formatDate(job.jobDate)}</span>
                  </div>
                  ${job.isDeadlinePassed ? '<span class="badge bg-warning text-dark"><i class="bi bi-clock me-1"></i>Deadline Passed</span>' : ''}
                  ${job.status === 'CANCELLED' ? '<span class="badge bg-danger ms-1">Cancelled</span>' : ''}
                  ${job.status === 'COMPLETED' ? '<span class="badge bg-primary ms-1">Completed</span>' : ''}
                </div>
                <div class="text-end">
                  <div class="fw-bold fs-5 text-success">₹${job.paymentAmount}</div>
                  <div class="small text-muted">${job.workersSelected || 0} / ${job.workersRequired} hired</div>
                </div>
              </div>
              <hr class="my-2">
              <h6 class="fw-semibold mb-2"><i class="bi bi-people me-1"></i>Student Information (${applicants.length} applicants)</h6>
              ${applicants.length === 0 ? '<div class="text-muted small">No students applied for this job.</div>' : `
              <div class="table-responsive">
                <table class="table table-sm align-middle mb-0">
                  <thead><tr><th>Student Name</th><th>College</th><th>Applied On</th><th>Status</th></tr></thead>
                  <tbody>
                    ${applicants.map(a => `
                      <tr>
                        <td class="fw-semibold">${App.escapeHtml(a.studentName)}${a.studentPhone ? ` <a href="tel:${a.studentPhone}" class="text-muted"><i class="bi bi-telephone-fill small"></i></a>` : ''}</td>
                        <td class="small text-muted">${App.escapeHtml(a.collegeName || '-')}</td>
                        <td class="small text-muted">${App.formatDate(a.appliedAt)} ${App.formatTime(a.appliedAt)}</td>
                        <td>${a.status === 'ACCEPTED' ? '<span class="badge bg-success">Accepted</span>' : a.status === 'REJECTED' ? '<span class="badge bg-danger">Rejected</span>' : '<span class="badge bg-warning text-dark">Pending</span>'}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>`}
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      container.innerHTML = `<div class="text-center text-danger p-3">Failed to load closed jobs: ${err.message}</div>`;
    }
  },

  previewJobPhoto(input) {
    const preview = document.getElementById('jobPhotoPreview');
    const img = preview?.querySelector('img');
    if (input.files && input.files[0] && img) {
      const file = input.files[0];
      if (file.size > 5 * 1024 * 1024) {
        App.showToast('File too large. Maximum size is 5MB.', 'warning');
        input.value = '';
        preview.classList.add('d-none');
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => { img.src = e.target.result; preview.classList.remove('d-none'); };
      reader.readAsDataURL(file);
    } else {
      preview.classList.add('d-none');
    }
  },

  async handleCreateJob(e) {
    e.preventDefault();
    const btn = document.getElementById('createJobSubmitBtn');
    try {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Posting Job...';

      // Upload photo first if selected
      let locationPhotoUrl = null;
      const photoFile = document.getElementById('jobLocationPhoto').files[0];
      if (photoFile) {
        const formData = new FormData();
        formData.append('image', photoFile);
        const uploadRes = await fetch('/api/upload/image', {
          method: 'POST',
          headers: {'Authorization': `Bearer ${API.getToken()}`},
          body: formData
        });
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok) throw new Error(uploadData.message || 'Failed to upload photo');
        locationPhotoUrl = uploadData.data?.url;
      }

      // Build apply deadline from date + time fields
      let applyDeadline = null;
      const deadlineDateEl = document.getElementById('jobApplyDeadlineDate');
      const deadlineTimeEl = document.getElementById('jobApplyDeadlineTime');
      if (deadlineDateEl?.value && deadlineTimeEl?.value) {
        applyDeadline = `${deadlineDateEl.value}T${deadlineTimeEl.value}:00`;
      } else if (deadlineDateEl?.value) {
        applyDeadline = `${deadlineDateEl.value}T23:59:59`;
      }

      const payload = {
        title: document.getElementById('jobTitle').value.trim(),
        description: document.getElementById('jobDescription').value.trim(),
        workType: document.getElementById('jobWorkType').value,
        workArea: document.getElementById('jobWorkArea').value.trim(),
        detailedLocation: document.getElementById('jobDetailedLocation').value.trim(),
        jobDate: document.getElementById('jobDate').value,
        startTime: document.getElementById('jobStartTime').value,
        endTime: document.getElementById('jobEndTime').value,
        paymentAmount: parseFloat(document.getElementById('jobPaymentAmount').value),
        paymentType: document.getElementById('jobPaymentType').value,
        onSpotPayment: document.getElementById('jobOnSpotCheckbox').checked,
        workersRequired: parseInt(document.getElementById('jobWorkersRequired').value, 10),
        requiredSkills: document.getElementById('jobRequiredSkills').value.trim(),
        contactPhone: document.getElementById('jobContactPhone').value.trim(),
        contactEmail: document.getElementById('jobContactEmail').value.trim(),
        applyDeadline,
        locationPhotoUrl,
        latitude: document.getElementById('jobLatitude').value || null,
        longitude: document.getElementById('jobLongitude').value || null,
        locationAddress: document.getElementById('jobLocationAddress').value || null
      };

      // Validate location is selected
      if (!payload.latitude || !payload.longitude) {
        App.showToast('Please capture the exact GPS location before posting this job.', 'warning');
        return;
      }

      await API.owner.createJob(payload);
      App.showToast('Job posted successfully!', 'success');

      // Reset form
      document.getElementById('createJobForm').reset();
      document.getElementById('jobOnSpotCheckbox').checked = true;
      document.getElementById('jobPhotoPreview').classList.add('d-none');
      document.getElementById('jobLatitude').value = '';
      document.getElementById('jobLongitude').value = '';
      document.getElementById('jobLocationAddress').value = '';
      document.getElementById('gpsLocationInfo').classList.add('d-none');
      document.getElementById('gpsLocationError').classList.add('d-none');
      document.getElementById('gpsLocationStatus').innerHTML = '<i class="bi bi-info-circle me-1"></i>Location not captured yet. Tap the button above.';

      // Switch to Active Jobs tab
      const tabEl = document.querySelector('button[data-bs-target="#ow-tab-jobs"]');
      if (tabEl) {
        const tab = new bootstrap.Tab(tabEl);
        tab.show();
      }

      await this.loadMyJobs();
    } catch (err) {
      App.showToast(err.message || 'Failed to post job', 'danger');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-plus-circle me-2"></i>Post Catering Job';
    }
  },

  async openApplicantsModal(jobId, jobTitle) {
    this.currentActiveJobId = jobId;
    document.getElementById('applicantsJobTitle').innerText = jobTitle;
    const container = document.getElementById('applicantsListContent');
    const modal = new bootstrap.Modal(document.getElementById('applicantsModal'));
    modal.show();

    try {
      container.innerHTML = '<div class="text-center p-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Loading applicants...</div>';
      const apps = await API.owner.getJobApplications(jobId);

      if (!apps || apps.length === 0) {
        container.innerHTML = '<div class="text-center p-4 text-muted">No students have applied for this job yet.</div>';
        return;
      }

      container.innerHTML = `
        <div class="table-responsive">
          <table class="table align-middle">
            <thead>
              <tr>
                <th>Student</th>
                <th>College / Skills</th>
                <th>Applied At</th>
                <th>Status</th>
                <th>Attendance</th>
                <th>Payment</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${apps.map(app => `
                <tr>
                  <td>
                    <div class="fw-bold">${App.escapeHtml(app.studentName)}</div>
                    <small class="text-muted"><i class="bi bi-star-fill text-warning me-1"></i>${app.studentRating || 5.0} (${app.totalJobsCompleted || 0} completed)</small>
                    ${app.status === 'ACCEPTED' || app.status === 'COMPLETED' ? `<div class="small text-primary"><a href="tel:${app.studentPhone}"><i class="bi bi-telephone-fill me-1"></i>${app.studentPhone}</a></div>` : ''}
                  </td>
                  <td>
                    <div class="small fw-semibold">${App.escapeHtml(app.collegeName || 'Student')}</div>
                    <div class="small text-muted">${App.escapeHtml(app.skills || 'General')}</div>
                    ${app.notes ? `<div class="small text-info mt-1"><em>Note: "${App.escapeHtml(app.notes)}"</em></div>` : ''}
                  </td>
                  <td class="small text-muted">${App.formatTimeAgo(app.appliedAt)}</td>
                  <td>
                    ${app.status === 'ACCEPTED' ? '<span class="badge bg-success">Accepted</span>' :
                      app.status === 'REJECTED' ? '<span class="badge bg-danger">Rejected</span>' :
                      app.status === 'CANCELLED' ? '<span class="badge bg-secondary">Cancelled</span>' :
                      app.status === 'COMPLETED' ? '<span class="badge bg-primary">Completed</span>' :
                      '<span class="badge bg-warning text-dark">Pending</span>'}
                  </td>
                  <td>
                    <select class="form-select form-select-sm" style="width: 120px;" onchange="Owner.updateAttendance(${app.id}, this.value)" ${app.status !== 'ACCEPTED' && app.status !== 'COMPLETED' ? 'disabled' : ''}>
                      <option value="NOT_MARKED" ${app.attendanceStatus === 'NOT_MARKED' ? 'selected' : ''}>Not Marked</option>
                      <option value="PRESENT" ${app.attendanceStatus === 'PRESENT' ? 'selected' : ''}>Present</option>
                      <option value="ABSENT" ${app.attendanceStatus === 'ABSENT' ? 'selected' : ''}>Absent</option>
                    </select>
                  </td>
                  <td>
                    ${app.paymentStatus === 'CONFIRMED' ? '<span class="badge bg-success"><i class="bi bi-check-all me-1"></i>Confirmed</span>' :
                      app.paymentStatus === 'PAID' ? '<span class="badge bg-info"><i class="bi bi-cash me-1"></i>Marked Paid</span>' :
                      app.paymentStatus === 'DISPUTED' ? '<span class="badge bg-danger"><i class="bi bi-exclamation-triangle me-1"></i>Disputed</span>' :
                      '<span class="badge bg-warning text-dark">Pending</span>'}
                  </td>
                  <td>
                    <div class="btn-group btn-group-sm">
                      ${app.status === 'APPLIED' ? `
                        <button class="btn btn-success" onclick="Owner.acceptApplicant(${app.id})"><i class="bi bi-check2"></i> Accept</button>
                        <button class="btn btn-outline-danger" onclick="Owner.rejectApplicant(${app.id})"><i class="bi bi-x"></i> Reject</button>
                      ` : ''}

                      
                      ${(app.status === 'ACCEPTED' || app.status === 'COMPLETED') && app.paymentStatus !== 'PAID' && app.paymentStatus !== 'CONFIRMED' ? `
                        <button class="btn btn-outline-success" onclick="Owner.markPaymentPaid(${app.id}, ${app.paymentAmount})">
                          <i class="bi bi-cash-stack"></i> Pay Student
                        </button>
                      ` : ''}
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (err) {
      container.innerHTML = `<div class="text-center text-danger p-3">Failed to load applicants: ${err.message}</div>`;
    }
  },

  async acceptApplicant(appId) {
    try {
      await API.owner.acceptApplicant(appId);
      App.showToast('Student accepted! Worker limit and status updated.', 'success');
      if (this.currentActiveJobId) {
        await this.openApplicantsModal(this.currentActiveJobId, document.getElementById('applicantsJobTitle').innerText);
      }
      await this.loadMyJobs();
    } catch (err) {
      App.showToast(err.message || 'Failed to accept applicant', 'danger');
    }
  },

  async rejectApplicant(appId) {
    if (!confirm('Reject this applicant?')) return;
    try {
      await API.owner.rejectApplicant(appId);
      App.showToast('Applicant rejected', 'info');
      if (this.currentActiveJobId) {
        await this.openApplicantsModal(this.currentActiveJobId, document.getElementById('applicantsJobTitle').innerText);
      }
      await this.loadMyJobs();
    } catch (err) {
      App.showToast(err.message || 'Failed to reject applicant', 'danger');
    }
  },

  async updateAttendance(appId, attendanceStatus) {
    try {
      await API.owner.markAttendance(appId, attendanceStatus, 'COMPLETED');
      App.showToast('Attendance updated to ' + attendanceStatus, 'success');
    } catch (err) {
      App.showToast(err.message || 'Failed to update attendance', 'danger');
    }
  },

  async completeJob(jobId) {
    if (!confirm('Are you sure you want to mark this catering job as COMPLETED?')) return;
    try {
      await API.owner.completeJob(jobId);
      App.showToast('Job marked as completed successfully!', 'success');
      await this.loadMyJobs();
    } catch (err) {
      App.showToast(err.message || 'Failed to complete job', 'danger');
    }
  },



  async deleteJob(jobId, jobTitle) {
    const btn = document.querySelector(`button[onclick*="Owner.deleteJob(${jobId}"]`);
    try {
      const result = await API.owner.cancelJob(jobId);
      if (result && result.requestCreated) {
        App.showToast(`Deletion request sent to the hired student(s). They will approve or reject the deletion.`, 'info');
      } else {
        App.showToast('Job deleted successfully!', 'success');
      }
      await this.loadMyJobs();
    } catch (err) {
      App.showToast(err.message || 'Failed to delete job', 'danger');
    }
  },

  async markPaymentPaid(appId, amount) {
    const notes = prompt(`Record payment of ₹${amount} to this student. Enter payment notes (optional, e.g. "Cash on spot" or "Bank transfer"):`, 'Paid to student by owner');
    if (notes === null) return;

    try {
      await API.owner.markPaymentPaid(appId, notes);
      App.showToast('Owner payment recorded. The student has been notified.', 'success');
      if (this.currentActiveJobId) {
        await this.openApplicantsModal(this.currentActiveJobId, document.getElementById('applicantsJobTitle').innerText);
      }
      await this.loadPayments();
    } catch (err) {
      App.showToast(err.message || 'Failed to mark payment', 'danger');
    }
  },

  async loadFullJobs() {
    const container = document.getElementById('owFullJobsList');
    if (!container) return;
    try {
      container.innerHTML = '<div class="col-12 text-center p-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Loading fully booked jobs...</div>';
      const jobs = await API.public.getFullJobs();
      if (!jobs || jobs.length === 0) {
        container.innerHTML = '<div class="col-12 text-center p-4 text-muted"><i class="bi bi-check-circle fs-2 d-block mb-2"></i>No fully booked jobs at the moment.</div>';
        return;
      }
      container.innerHTML = jobs.map(job => App.renderJobCard(job, 'owner', true)).join('');
    } catch (e) {
      container.innerHTML = '<div class="col-12 text-center text-danger p-3">Failed to load fully booked jobs</div>';
    }
  },

  _allPayments: [],
  _currentFilter: 'ALL',

  async loadPayments() {
    const container = document.getElementById('owPaymentsList');
    if (!container) return;

    try {
      container.innerHTML = '<tr><td colspan="5" class="text-center p-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Loading payments...</td></tr>';
      const payments = await API.owner.getPayments();
      this._allPayments = payments || [];

      // Calculate summary
      let totalPaid = 0, totalPending = 0, totalAll = 0;
      this._allPayments.forEach(p => {
        const amt = Number(p.amount) || 0;
        totalAll += amt;
        if (p.paymentStatus === 'PAID' || p.paymentStatus === 'CONFIRMED') totalPaid += amt;
        else totalPending += amt;
      });

      document.getElementById('owStatTotalPayments').innerText = '₹' + totalPaid.toLocaleString();
      document.getElementById('owPayPending').innerText = '₹' + totalPending.toLocaleString();
      document.getElementById('owPayPaid').innerText = '₹' + totalPaid.toLocaleString();
      document.getElementById('owPayTotal').innerText = '₹' + totalAll.toLocaleString();

      this.filterPayments(this._currentFilter);
    } catch (err) {
      container.innerHTML = `<tr><td colspan="5" class="text-center p-3 text-danger">Failed to load payments</td></tr>`;
    }
  },

  filterPayments(status) {
    this._currentFilter = status;
    const container = document.getElementById('owPaymentsList');
    if (!container) return;

    // Update active filter button
    ['All', 'Pending', 'Paid'].forEach(label => {
      const btn = document.getElementById('owPayFilter' + label);
      if (!btn) return;
      btn.className = btn.id === 'owPayFilter' + status ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-outline-secondary';
    });

    let filtered = this._allPayments;
    if (status === 'PENDING') filtered = filtered.filter(p => p.paymentStatus === 'PENDING');
    else if (status === 'PAID') filtered = filtered.filter(p => p.paymentStatus === 'PAID' || p.paymentStatus === 'CONFIRMED');

    if (!filtered.length) {
      container.innerHTML = '<tr><td colspan="5" class="text-center p-4 text-muted">No payments in this category.</td></tr>';
      return;
    }

    container.innerHTML = filtered.map(pay => {
      let statusBadge = '<span class="badge bg-warning">Pending</span>';
      if (pay.paymentStatus === 'PAID') statusBadge = '<span class="badge bg-info">Paid</span>';
      else if (pay.paymentStatus === 'CONFIRMED') statusBadge = '<span class="badge bg-success">Confirmed</span>';
      else if (pay.paymentStatus === 'DISPUTED') statusBadge = '<span class="badge bg-danger">Disputed</span>';

      return `<tr>
        <td>
          <div class="fw-bold">${App.escapeHtml(pay.jobTitle)}</div>
          <small class="text-muted">${App.escapeHtml(pay.workArea || '')}</small>
        </td>
        <td>
          <div class="fw-semibold">${App.escapeHtml(pay.studentName)}</div>
        </td>
        <td class="fw-bold text-success">₹${pay.amount}</td>
        <td>${statusBadge}</td>
        <td><small class="text-muted">${App.formatDate(pay.markedPaidAt || pay.createdAt)}</small></td>
      </tr>`;
    }).join('');
  },

  
  // ─── OWNER TRANSACTION HISTORY ────────────────────────────────────────────

  async loadTransactions() {
    const container = document.getElementById('owTransactionsList');
    if (!container) return;

    try {
      container.innerHTML = '<tr><td colspan="7" class="text-center p-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Loading transaction history...</td></tr>';
      const transactions = await API.owner.getRazorpayTransactions();

      if (!transactions || transactions.length === 0) {
        container.innerHTML = '<tr><td colspan="7" class="text-center p-4 text-muted"><i class="bi bi-receipt fs-2 d-block mb-2"></i>No payment transactions yet. Student payments for your jobs will appear here.</td></tr>';
        return;
      }

      let filterHtml = '<tr><td colspan="7" class="p-2"><div class="d-flex flex-wrap gap-2 align-items-center">' +
        '<small class="text-muted fw-semibold"><i class="bi bi-funnel me-1"></i>Filter:</small>' +
        '<select id="owTxFilter" class="form-select form-select-sm" style="width:auto;" onchange="Owner.filterTransactions()">' +
        '<option value="all">All Status</option><option value="SUCCESS">Paid</option><option value="PENDING">Pending</option>' +
        '<option value="CREATED">Processing</option><option value="FAILED">Failed</option><option value="CANCELLED">Cancelled</option></select>' +
        '<small class="text-muted">Total: ' + transactions.length + ' transaction(s)</small>' +
        '<span class="badge bg-warning-subtle text-warning border border-warning-subtle"><i class="bi bi-info-circle me-1"></i>TEST MODE</span>' +
        '</div></td></tr>';

      container.innerHTML = filterHtml + transactions.map(t => {
        let statusBadge = '';
        if (t.paymentStatus === 'SUCCESS' || t.paymentStatus === 'CONFIRMED') statusBadge = '<span class="badge bg-success"><i class="bi bi-check-circle me-1"></i>Paid</span>';
        else if (t.paymentStatus === 'CREATED') statusBadge = '<span class="badge bg-info"><i class="bi bi-hourglass-split me-1"></i>Processing</span>';
        else if (t.paymentStatus === 'FAILED') statusBadge = '<span class="badge bg-danger"><i class="bi bi-x-circle me-1"></i>Failed</span>';
        else if (t.paymentStatus === 'CANCELLED') statusBadge = '<span class="badge bg-secondary"><i class="bi bi-dash-circle me-1"></i>Cancelled</span>';
        else statusBadge = '<span class="badge bg-warning text-dark"><i class="bi bi-clock me-1"></i>Pending</span>';

        const methodBadge = t.paymentMethod ? '<span class="badge bg-primary-subtle text-primary border border-primary-subtle small"><i class="bi bi-credit-card me-1"></i>' + App.escapeHtml(t.paymentMethod) + '</span>' : '';

        return '<tr data-status="' + t.paymentStatus + '" onclick="Owner.viewTransactionDetail(' + t.id + ')" style="cursor:pointer;" class="table-row-hover">' +
          '<td><div class="fw-bold">' + App.escapeHtml(t.jobTitle || 'Job') + '</div><small class="text-muted">' + App.escapeHtml(t.workArea || '') + '</small></td>' +
          '<td><div class="fw-semibold">' + App.escapeHtml(t.studentName || 'Student') + '</div><small class="text-muted">' + App.escapeHtml(t.studentEmail || '') + '</small></td>' +
          '<td>\u20B9' + t.amount + '</td>' +
          '<td>' + statusBadge + ' ' + methodBadge + '</td>' +
          '<td><small class="text-muted">' + App.formatDate(t.confirmedPaidAt || t.markedPaidAt || t.createdAt) + '</small></td>' +
          '<td><span class="badge bg-warning-subtle text-warning border border-warning-subtle small"><i class="bi bi-info-circle me-1"></i>TEST</span></td>' +
          '<td><button class="btn btn-sm btn-outline-primary" onclick="event.stopPropagation(); Owner.viewTransactionDetail(' + t.id + ')"><i class="bi bi-eye"></i></button></td>' +
          '</tr>';
      }).join('');
      this._txData = transactions;
    } catch (err) {
      container.innerHTML = '<tr><td colspan="7" class="text-center p-3 text-danger">Failed to load transaction history: ' + err.message + '</td></tr>';
    }
  },

  filterTransactions() {
    const filter = document.getElementById('owTxFilter')?.value || 'all';
    const rows = document.querySelectorAll('#owTransactionsList tr[data-status]');
    rows.forEach(r => { r.style.display = (filter === 'all' || r.dataset.status === filter) ? '' : 'none'; });
  },

  async viewTransactionDetail(txId) {
    const body = document.getElementById('txDetailBody');
    body.innerHTML = '<div class="text-center py-4"><span class="spinner-border text-primary"></span><div class="small text-muted mt-2">Loading...</div></div>';
    new bootstrap.Modal(document.getElementById('txDetailModal')).show();

    try {
      const tx = await API.owner.getRazorpayTransaction(txId);
      if (!tx) throw new Error('Transaction not found');

      let statusColor = 'warning';
      if (tx.paymentStatus === 'SUCCESS' || tx.paymentStatus === 'CONFIRMED') statusColor = 'success';
      else if (tx.paymentStatus === 'FAILED') statusColor = 'danger';
      else if (tx.paymentStatus === 'CANCELLED') statusColor = 'secondary';

      body.innerHTML = '<div class="p-3 rounded mb-3" style="background: var(--color-surface-sunken);">' +
        '<div class="d-flex justify-content-between align-items-start"><div>' +
        '<h6 class="fw-bold mb-1">\u20B9' + tx.amount + '</h6>' +
        '<div class="small text-muted">' + App.escapeHtml(tx.jobTitle || 'Job') + ' \u2022 ' + App.escapeHtml(tx.studentName || '') + '</div>' +
        '</div><span class="badge bg-' + statusColor + '">' + tx.paymentStatus + '</span></div></div>' +
        '<div class="d-flex align-items-center gap-2 mb-3 p-2 rounded" style="background: rgba(217,119,6,0.1); border: 1px solid rgba(217,119,6,0.2);">' +
        '<i class="bi bi-info-circle-fill text-warning"></i>' +
        '<small class="fw-semibold text-warning">TEST MODE \u2014 No real money transferred</small></div>' +
        '<div class="row g-3 small">' +
        '<div class="col-sm-6"><div class="text-muted">Transaction ID</div><div class="fw-bold">TXN-' + String(tx.id).padStart(8, '0') + '</div></div>' +
        '<div class="col-sm-6"><div class="text-muted">Payment Status</div><div class="fw-bold text-' + statusColor + '">' + tx.paymentStatus + '</div></div>' +
        (tx.razorpayOrderId ? '<div class="col-sm-6"><div class="text-muted">Razorpay Order ID</div><div class="fw-bold text-break">' + App.escapeHtml(tx.razorpayOrderId) + '</div></div>' : '') +
        (tx.razorpayPaymentId ? '<div class="col-sm-6"><div class="text-muted">Razorpay Payment ID</div><div class="fw-bold text-break">' + App.escapeHtml(tx.razorpayPaymentId) + '</div></div>' : '') +
        (tx.paymentMethod ? '<div class="col-sm-6"><div class="text-muted">Payment Method</div><div class="fw-bold">' + App.escapeHtml(tx.paymentMethod) + '</div></div>' : '') +
        '<div class="col-sm-6"><div class="text-muted">Amount</div><div class="fw-bold">\u20B9' + tx.amount + '</div></div>' +
        '<div class="col-sm-6"><div class="text-muted">Currency</div><div class="fw-bold">' + (tx.currency || 'INR') + '</div></div>' +
        '<div class="col-sm-6"><div class="text-muted">Environment</div><div><span class="badge bg-warning-subtle text-warning border border-warning-subtle">TEST MODE</span></div></div>' +
        '<div class="col-sm-6"><div class="text-muted">Payment Type</div><div class="fw-bold">' + App.escapeHtml(tx.paymentType || 'On-Spot') + '</div></div>' +
        '<div class="col-12"><hr></div>' +
        '<div class="col-sm-6"><div class="text-muted">Job</div><div class="fw-bold">' + App.escapeHtml(tx.jobTitle || '-') + '</div><div class="small text-muted">' + App.escapeHtml(tx.workArea || '') + '</div></div>' +
        '<div class="col-sm-6"><div class="text-muted">Student</div><div class="fw-bold">' + App.escapeHtml(tx.studentName || '-') + '</div><div class="small text-muted">' + App.escapeHtml(tx.studentEmail || '') + '</div>' + (tx.collegeName ? '<div class="small text-muted">' + App.escapeHtml(tx.collegeName) + '</div>' : '') + '</div>' +
        '<div class="col-12"><hr></div>' +
        '<div class="col-sm-6"><div class="text-muted">Created</div><div>' + App.formatDate(tx.createdAt) + '</div></div>' +
        (tx.confirmedPaidAt ? '<div class="col-sm-6"><div class="text-muted">Payment Completed</div><div>' + App.formatDate(tx.confirmedPaidAt) + '</div></div>' : '') +
        '</div>';
    } catch (e) {
      body.innerHTML = '<div class="text-center p-4 text-danger"><i class="bi bi-exclamation-triangle fs-3 d-block mb-2"></i>Failed to load transaction: ' + e.message + '</div>';
    }
  },

async loadComplaints() {
    const container = document.getElementById('owComplaintsList');
    if (!container) return;

    try {
      container.innerHTML = '<div class="text-center p-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Loading complaints...</div>';
      const complaints = await API.owner.getComplaints();

      if (!complaints || complaints.length === 0) {
        container.innerHTML = '<div class="text-center p-4 text-muted"><i class="bi bi-chat-square-check fs-2 d-block mb-2"></i>No student complaints have been received.</div>';
        return;
      }

      container.innerHTML = complaints.map(report => `
        <article class="card border mb-3 shadow-sm">
          <div class="card-body">
            <div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
              <div>
                <span class="badge bg-danger-subtle text-danger mb-2">${App.escapeHtml(report.reportType || 'Complaint')}</span>
                <h6 class="fw-bold mb-1">${App.escapeHtml(report.jobTitle || 'Job not available')}</h6>
                <small class="text-muted">Reported ${App.formatDate(report.createdAt)}${report.workArea ? ` &middot; ${App.escapeHtml(report.workArea)}` : ''}</small>
              </div>
              <span class="badge ${report.status === 'RESOLVED' ? 'bg-success' : 'bg-warning text-dark'}">${App.escapeHtml(report.status || 'PENDING')}</span>
            </div>

            <div class="row g-3 mb-3">
              <div class="col-md-6">
                <div class="p-3 bg-light rounded h-100">
                  <div class="small text-muted mb-1">Student details</div>
                  <div class="fw-bold">${App.escapeHtml(report.studentName || 'Student')}</div>
                  <div class="small mt-1"><i class="bi bi-telephone me-1"></i><a href="tel:${App.escapeHtml(report.studentPhone || '')}">${App.escapeHtml(report.studentPhone || 'Phone unavailable')}</a></div>
                  <div class="small"><i class="bi bi-envelope me-1"></i><a href="mailto:${App.escapeHtml(report.studentEmail || '')}">${App.escapeHtml(report.studentEmail || 'Email unavailable')}</a></div>
                  <div class="small text-muted mt-1">Skills: ${App.escapeHtml(report.studentSkills || 'Not provided')}</div>
                  <div class="small text-muted">Area: ${App.escapeHtml(report.studentArea || 'Not provided')}</div>
                </div>
              </div>
              <div class="col-md-6">
                <div class="p-3 bg-light rounded h-100">
                  <div class="small text-muted mb-1">Payment and application</div>
                  <div class="small">Actual Amount: <strong class="text-primary">₹${App.escapeHtml(report.assignedAmount ?? 'Not available')}</strong></div>
                  <div class="small">Expected in complaint: <strong>₹${App.escapeHtml(report.expectedAmount ?? 'Not provided')}</strong></div>
                  <div class="small">Received: <strong>₹${App.escapeHtml(report.receivedAmount ?? '0')}</strong></div>
                  <div class="small">Application: <strong>${App.escapeHtml(report.applicationStatus || 'Not available')}</strong></div>
                  <div class="small">Payment status: <strong>${App.escapeHtml(report.applicationPaymentStatus || 'Not available')}</strong></div>
                </div>
              </div>
            </div>

            <div class="mb-2"><strong>Student&apos;s message:</strong> <span class="text-muted">${App.escapeHtml(report.description || 'No description provided')}</span></div>
            <div class="small text-muted mb-3"><strong>Evidence / additional notes:</strong> ${App.escapeHtml(report.evidenceNotes || 'None provided')}</div>
            <div class="alert alert-info py-2 mb-0 small"><i class="bi bi-chat-dots me-1"></i>Contact the student by phone or email above to discuss the issue, then cooperate with the platform admin review.</div>
          </div>
        </article>
      `).join('');
    } catch (err) {
      container.innerHTML = `<div class="text-center text-danger p-3">Failed to load complaints: ${App.escapeHtml(err.message)}</div>`;
    }
  },

  enterProfileEditMode() {
    document.getElementById('owProfileView')?.classList.add('d-none');
    document.getElementById('ownerProfileForm')?.classList.remove('d-none');
    document.getElementById('owProfEditBtn')?.classList.add('d-none');
  },

  exitProfileEditMode() {
    document.getElementById('ownerProfileForm')?.classList.add('d-none');
    document.getElementById('owProfileView')?.classList.remove('d-none');
    document.getElementById('owProfEditBtn')?.classList.remove('d-none');
  },

  async makeDecision(jobId, decision) {
    const msg = decision === 'CONTINUE'
      ? 'Continue this job even though not all positions are filled? The accepted workers will proceed as planned.'
      : 'Remove this job? It will no longer be available to students and pending applications will be cancelled.';
    if (!confirm(msg)) return;
    try {
      await API.owner.makeDecision(jobId, decision);
      App.showToast(decision === 'CONTINUE' ? 'Job confirmed to continue!' : 'Job removed successfully.', 'success');
      await this.loadMyJobs();
    } catch (err) {
      App.showToast(err.message || 'Failed to process decision', 'danger');
    }
  },

  async removeJobConfirm(jobId, jobTitle) {
    if (!confirm('Are you sure you want to remove "' + jobTitle + '"? It will no longer be available to students.')) return;
    try {
      await API.owner.removeJob(jobId);
      App.showToast('Job removed successfully!', 'success');
      await this.loadMyJobs();
    } catch (err) {
      App.showToast(err.message || 'Failed to remove job', 'danger');
    }
  },

  // ─── Browser GPS Location Capture ─────────────────────────────────────────

  captureGpsLocation() {
    if (!navigator.geolocation) {
      this._showGpsError('Geolocation is not supported by your browser.');
      return;
    }

    const btn = document.getElementById('gpsCaptureBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Capturing Location...';
    document.getElementById('gpsLocationStatus').innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Requesting location permission...';
    document.getElementById('gpsLocationError').classList.add('d-none');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const accuracy = position.coords.accuracy;

        // Store coordinates in hidden fields
        document.getElementById('jobLatitude').value = lat;
        document.getElementById('jobLongitude').value = lng;

        // Show coordinates
        document.getElementById('gpsLat').textContent = lat.toFixed(6);
        document.getElementById('gpsLng').textContent = lng.toFixed(6);
        document.getElementById('gpsAccuracy').textContent = 'Accuracy: \u00B1' + Math.round(accuracy) + ' meters';

        // Try reverse geocoding using free Nominatim API
        document.getElementById('gpsLocationStatus').innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Getting address...';
        fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`, {
          headers: { 'Accept-Language': 'en' }
        })
        .then(res => res.json())
        .then(data => {
          const address = data.display_name || lat.toFixed(6) + ', ' + lng.toFixed(6);
          document.getElementById('jobLocationAddress').value = address;
          document.getElementById('gpsAddress').textContent = address;
          document.getElementById('gpsLocationStatus').innerHTML = '<i class="bi bi-check-circle text-success me-1"></i>Location captured successfully!';
          document.getElementById('gpsLocationInfo').classList.remove('d-none');
          btn.disabled = false;
          btn.innerHTML = '<i class="bi bi-arrow-repeat me-2"></i>Capture Again';
        })
        .catch(() => {
          // Even if geocoding fails, coordinates are saved
          const fallback = lat.toFixed(6) + ', ' + lng.toFixed(6);
          document.getElementById('jobLocationAddress').value = fallback;
          document.getElementById('gpsAddress').textContent = fallback;
          document.getElementById('gpsLocationStatus').innerHTML = '<i class="bi bi-check-circle text-success me-1"></i>Location captured! (Address lookup unavailable)';
          document.getElementById('gpsLocationInfo').classList.remove('d-none');
          btn.disabled = false;
          btn.innerHTML = '<i class="bi bi-arrow-repeat me-2"></i>Capture Again';
        });
      },
      (error) => {
        let msg;
        switch (error.code) {
          case error.PERMISSION_DENIED:
            msg = 'Location permission was denied. Please allow location access in your browser/device settings and try again.';
            break;
          case error.POSITION_UNAVAILABLE:
            msg = 'Your location could not be determined. Please check your device location services and try again.';
            break;
          case error.TIMEOUT:
            msg = 'Getting your location took too long. Please try again.';
            break;
          default:
            msg = 'Unable to get your location. Please try again.';
        }
        this._showGpsError(msg);
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-crosshair me-2"></i>Get Exact GPS Location';
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  },

  _showGpsError(msg) {
    document.getElementById('gpsErrorMsg').textContent = msg;
    document.getElementById('gpsLocationError').classList.remove('d-none');
    document.getElementById('gpsLocationStatus').innerHTML = '<i class="bi bi-info-circle me-1"></i>Location capture failed. Try again.';
  },

  // ─── OWNER TRANSACTION HISTORY ─────────────────────────────────────────

  _txData: [],

  async loadTransactions() {
    const container = document.getElementById('owTxList');
    if (!container) return;
    try {
      container.innerHTML = '<tr><td colspan="7" class="text-center p-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Loading transactions...</td></tr>';
      const txns = await API.owner.getRazorpayTransactions();
      this._txData = txns || [];
      this._renderOwnerTransactions();
    } catch (err) {
      container.innerHTML = '<tr><td colspan="7" class="text-center p-3 text-danger">Failed to load transactions</td></tr>';
    }
  },

  _renderOwnerTransactions() {
    const container = document.getElementById('owTxList');
    if (!container) return;
    const data = this._txData;

    // Update summary stats
    const all = data;
    const successCount = all.filter(t => t.paymentStatus === 'SUCCESS').length;
    const failedCount = all.filter(t => t.paymentStatus === 'FAILED').length;
    const pendingCount = all.filter(t => t.paymentStatus === 'CREATED').length;
    const revenue = all.filter(t => t.paymentStatus === 'SUCCESS').reduce((s, t) => s + Number(t.amount || 0), 0);
    const revEl = document.getElementById('owTxRevenue');
    const succEl = document.getElementById('owTxSuccessCount');
    const failEl = document.getElementById('owTxFailedCount');
    const pendEl = document.getElementById('owTxPendingCount');
    if (revEl) revEl.textContent = '₹' + revenue.toLocaleString('en-IN');
    if (succEl) succEl.textContent = successCount;
    if (failEl) failEl.textContent = failedCount;
    if (pendEl) pendEl.textContent = pendingCount;

    if (!data || data.length === 0) {
      container.innerHTML = '<tr><td colspan="7" class="text-center p-4 text-muted">No transactions yet. When students pay for your jobs online, transactions will appear here.</td></tr>';
      return;
    }

    container.innerHTML = data.map(tx => {
      const isOnline = !!(tx.razorpayPaymentId || tx.paymentMethod);
      const statusBadge = tx.paymentStatus === 'SUCCESS' ? '<span class="badge bg-success"><i class="bi bi-check-circle me-1"></i>Paid</span>' :
        tx.paymentStatus === 'CREATED' ? '<span class="badge bg-warning text-dark">Processing</span>' :
        tx.paymentStatus === 'FAILED' ? '<span class="badge bg-danger">Failed</span>' :
        tx.paymentStatus === 'CANCELLED' ? '<span class="badge bg-secondary">Cancelled</span>' :
        '<span class="badge bg-warning text-dark">Pending</span>';
      const methodBadge = isOnline ? '<span class="badge bg-info-subtle text-info border border-info-subtle"><i class="bi bi-credit-card me-1"></i>Online</span>' :
        '<span class="badge bg-primary-subtle text-primary border">On-Spot</span>';
      return `
        <tr>
          <td>
            <div class="fw-bold">${App.escapeHtml(tx.jobTitle || 'Job')}</div>
            <small class="text-muted">${App.escapeHtml(tx.workArea || '')}</small>
          </td>
          <td class="fw-semibold">${App.escapeHtml(tx.studentName || 'Student')}</td>
          <td class="fw-bold text-success">₹${tx.amount}</td>
          <td>${methodBadge}</td>
          <td>
            ${statusBadge}
            ${tx.razorpayPaymentId ? '<br><small class="text-muted">' + App.escapeHtml(tx.razorpayPaymentId.substring(0, 16)) + '...</small>' : ''}
            ${tx.environment ? '<br><span class="badge bg-warning-subtle text-warning border border-warning-subtle small mt-1"><i class="bi bi-info-circle me-1"></i>TEST</span>' : ''}
          </td>
          <td><small class="text-muted">${App.formatDate(tx.createdAt)}</small></td>
          <td><button class="btn btn-sm btn-outline-primary" onclick="Owner.viewOwnerTransactionDetail(${tx.id})"><i class="bi bi-eye"></i></button></td>
        </tr>`;
    }).join('');
  },

  async viewOwnerTransactionDetail(txId) {
    const body = document.getElementById('txDetailBody');
    if (!body) return;
    body.innerHTML = '<div class="text-center py-4"><span class="spinner-border text-primary"></span><div class="small text-muted mt-2">Loading transaction...</div></div>';
    new bootstrap.Modal(document.getElementById('txDetailModal')).show();
    try {
      const tx = await API.owner.getRazorpayTransaction(txId);
      body.innerHTML = `
        <div class="p-3 rounded mb-3" style="background: var(--color-surface-sunken);">
          <div class="d-flex justify-content-between align-items-start">
            <div>
              <div class="fw-bold fs-5">₹${tx.amount}</div>
              <div class="small text-muted">Payment for: ${App.escapeHtml(tx.jobTitle || 'Job')}</div>
            </div>
            <span class="badge ${tx.paymentStatus === 'SUCCESS' ? 'bg-success' : tx.paymentStatus === 'FAILED' ? 'bg-danger' : 'bg-warning text-dark'} fs-6">${tx.paymentStatus}</span>
          </div>
        </div>
        <div class="d-flex align-items-center gap-2 mb-3 p-2 rounded" style="background: rgba(217,119,6,0.1); border: 1px solid rgba(217,119,6,0.2);">
          <i class="bi bi-info-circle-fill text-warning"></i>
          <small class="fw-semibold text-warning">TEST MODE — No real money transferred</small>
        </div>
        <div class="row g-3">
          <div class="col-md-6">
            <div class="small text-muted">Transaction ID</div>
            <div class="fw-semibold">TXN-${String(tx.id).padStart(8, '0')}</div>
          </div>
          <div class="col-md-6">
            <div class="small text-muted">Job</div>
            <div class="fw-semibold">${App.escapeHtml(tx.jobTitle || 'N/A')}</div>
          </div>
          <div class="col-md-6">
            <div class="small text-muted">Student</div>
            <div class="fw-semibold">${App.escapeHtml(tx.studentName || 'N/A')}</div>
          </div>
          <div class="col-md-6">
            <div class="small text-muted">Student Email</div>
            <div class="fw-semibold">${App.escapeHtml(tx.studentEmail || 'N/A')}</div>
          </div>
          <div class="col-md-6">
            <div class="small text-muted">Job Date</div>
            <div class="fw-semibold">${App.formatDate(tx.jobDate)}</div>
          </div>
          <div class="col-md-6">
            <div class="small text-muted">Work Area</div>
            <div class="fw-semibold">${App.escapeHtml(tx.workArea || 'N/A')}</div>
          </div>
          <div class="col-md-6">
            <div class="small text-muted">Payment Method</div>
            <div class="fw-semibold">${App.escapeHtml(tx.paymentMethod || 'N/A')}</div>
          </div>
          <div class="col-md-6">
            <div class="small text-muted">Currency</div>
            <div class="fw-semibold">INR (₹)</div>
          </div>
          ${tx.razorpayOrderId ? `<div class="col-md-6"><div class="small text-muted">Razorpay Order ID</div><div class="fw-semibold"><code>${App.escapeHtml(tx.razorpayOrderId)}</code></div></div>` : ''}
          ${tx.razorpayPaymentId ? `<div class="col-md-6"><div class="small text-muted">Razorpay Payment ID</div><div class="fw-semibold"><code>${App.escapeHtml(tx.razorpayPaymentId)}</code></div></div>` : ''}
          <div class="col-md-6">
            <div class="small text-muted">Environment</div>
            <div><span class="badge bg-warning-subtle text-warning border border-warning-subtle">TEST MODE</span></div>
          </div>
          <div class="col-md-6">
            <div class="small text-muted">Created</div>
            <div class="fw-semibold">${App.formatDate(tx.createdAt)}</div>
          </div>
          ${tx.confirmedPaidAt ? `<div class="col-md-6"><div class="small text-muted">Completed</div><div class="fw-semibold">${App.formatDate(tx.confirmedPaidAt)}</div></div>` : ''}
        </div>
        <div class="text-center mt-4">
          <button class="btn btn-sm btn-outline-secondary" data-bs-dismiss="modal">Close</button>
        </div>
      `;
    } catch (err) {
      body.innerHTML = '<div class="text-center p-4 text-danger">Failed to load transaction details: ' + App.escapeHtml(err.message) + '</div>';
    }
  },

};
