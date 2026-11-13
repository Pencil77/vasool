// =========================================================================
    // AUTHENTICATION HANDLERS (EMAIL & PASSWORD + OTP & PASSWORD RESET)
    // =========================================================================
    function toggleAuthOrAppView() {
      showingAuthPortal = !showingAuthPortal;
      renderTopLevelView();
    }

    function renderTopLevelView() {
      const authSec = document.getElementById('authViewSection');
      const appSec = document.getElementById('appWorkspaceSection');
      const toggleBtn = document.getElementById('btnToggleViewMode');
      const authBanner = document.getElementById('authActiveUserBanner');
      const mobileNav = document.getElementById('mobileBottomNav');
      const mobileFab = document.getElementById('mobileFabAddExpense');

      if (showingAuthPortal || !appState.currentUser) {
        authSec.classList.remove('hidden');
        appSec.classList.add('hidden');
        if (mobileNav) mobileNav.classList.add('hidden');
        if (mobileFab) mobileFab.classList.add('hidden');
        if (toggleBtn) {
          toggleBtn.textContent = appState.currentUser ? 'Back to Dashboard' : 'Auth Portal Active';
        }
        if (authBanner) {
          if (appState.currentUser) {
            authBanner.classList.remove('hidden');
            const bannerName = document.getElementById('authBannerUserName');
            if (bannerName) bannerName.textContent = appState.currentUser.name;
          } else {
            authBanner.classList.add('hidden');
          }
        }
      } else {
        authSec.classList.add('hidden');
        appSec.classList.remove('hidden');
        if (mobileNav) mobileNav.classList.remove('hidden');
        if (mobileFab) mobileFab.classList.remove('hidden');
        if (toggleBtn) {
          toggleBtn.textContent = 'Switch to Auth Portal';
        }
        if (authBanner) {
          authBanner.classList.add('hidden');
        }
      }

      const headerArea = document.getElementById('headerUserArea');
      if (appState.currentUser) {
        if (headerArea) {
          headerArea.classList.remove('hidden');
          headerArea.classList.add('flex');
        }
        const initials = (appState.currentUser.name || 'User')
          .split(' ')
          .map((w) => w[0])
          .join('')
          .slice(0, 2)
          .toUpperCase();
        const isSuper = appState.currentUser.isSuperAdmin || appState.currentUser.role === 'super_admin' || (appState.currentUser.email && appState.currentUser.email.toLowerCase() === 'mdzubair7592@gmail.com');
        const superBtn = document.getElementById('btnHeaderSuperAdmin');
        if (superBtn) {
          if (isSuper) {
            superBtn.className = 'hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gradient-to-r from-amber-500/20 to-yellow-500/20 border border-amber-400/50 text-amber-300 hover:bg-amber-500/30 text-xs font-bold transition flex-shrink-0 shadow-sm shadow-amber-500/20';
          } else {
            superBtn.className = 'hidden';
          }
        }
        const navTabAdmin = document.getElementById('navTabAdmin');
        if (navTabAdmin) {
          if (isSuper) {
            navTabAdmin.classList.remove('hidden');
            navTabAdmin.classList.add('inline-flex');
          } else {
            navTabAdmin.classList.add('hidden');
            navTabAdmin.classList.remove('inline-flex');
          }
        }
        const mobileNavAdmin = document.getElementById('mobileNavAdmin');
        const mobileNavGrid = document.getElementById('mobileBottomNavGrid');
        if (mobileNavAdmin) {
          if (isSuper) {
            mobileNavAdmin.classList.remove('hidden');
            mobileNavAdmin.classList.add('flex');
            if (mobileNavGrid) {
              mobileNavGrid.classList.remove('grid-cols-4');
              mobileNavGrid.classList.add('grid-cols-5');
            }
          } else {
            mobileNavAdmin.classList.add('hidden');
            mobileNavAdmin.classList.remove('flex');
            if (mobileNavGrid) {
              mobileNavGrid.classList.remove('grid-cols-5');
              mobileNavGrid.classList.add('grid-cols-4');
            }
          }
        }
        const avatarEl = document.getElementById('headerUserAvatar');
        if (avatarEl) {
          avatarEl.textContent = initials;
          if (isSuper) {
            avatarEl.className = 'cursor-pointer w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-gradient-to-br from-amber-500/30 to-yellow-500/30 border-2 border-amber-400 flex items-center justify-center text-[11px] sm:text-xs font-extrabold text-amber-300 flex-shrink-0 shadow-lg shadow-amber-500/20 hover:scale-105 transition';
            avatarEl.title = 'Super Admin (App Owner)';
          } else {
            avatarEl.className = 'cursor-pointer w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-gradient-to-br from-emerald-500/30 to-teal-500/30 border border-emerald-400/40 flex items-center justify-center text-[11px] sm:text-xs font-bold text-emerald-300 flex-shrink-0 hover:border-emerald-400 transition';
            avatarEl.title = 'Account Settings & Profile';
          }
        }
        const nameEl = document.getElementById('headerUserName');
        if (nameEl) nameEl.textContent = appState.currentUser.name;
        const provEl = document.getElementById('headerUserProvider');
        if (provEl) {
          if (isSuper) {
            provEl.innerHTML = '<span class="inline-flex items-center gap-1 text-[10px] font-extrabold text-amber-400 tracking-wide"><span>👑</span> SUPER ADMIN</span>';
          } else {
            provEl.textContent = appState.currentUser.isEmailVerified !== false ? '✓ Verified Account' : '⚠️ Unverified';
          }
        }
        const welcomeEl = document.getElementById('welcomeUserName');
        if (welcomeEl) welcomeEl.textContent = (appState.currentUser.name || 'Friend').split(' ')[0];

        // Strictly restrict System Status footer option to Super Admin only
        ['btnFooterSystemStatus', 'sepFooterSystemStatus', 'btnAuthFooterSystemStatus', 'sepAuthFooterSystemStatus'].forEach((id) => {
          const el = document.getElementById(id);
          if (el) {
            if (isSuper) el.classList.remove('hidden');
            else el.classList.add('hidden');
          }
        });
      } else {
        if (headerArea) {
          headerArea.classList.add('hidden');
          headerArea.classList.remove('flex');
        }
        const navTabAdmin = document.getElementById('navTabAdmin');
        if (navTabAdmin) {
          navTabAdmin.classList.add('hidden');
          navTabAdmin.classList.remove('inline-flex');
        }
        const mobileNavAdmin = document.getElementById('mobileNavAdmin');
        if (mobileNavAdmin) {
          mobileNavAdmin.classList.add('hidden');
          mobileNavAdmin.classList.remove('flex');
        }
        const mobileNavGrid = document.getElementById('mobileBottomNavGrid');
        if (mobileNavGrid) {
          mobileNavGrid.classList.remove('grid-cols-5');
          mobileNavGrid.classList.add('grid-cols-4');
        }
        ['btnFooterSystemStatus', 'sepFooterSystemStatus', 'btnAuthFooterSystemStatus', 'sepAuthFooterSystemStatus'].forEach((id) => {
          const el = document.getElementById(id);
          if (el) el.classList.add('hidden');
        });
      }
    }

    let currentAuthMode = 'login';

    function switchAuthTab(mode) {
      currentAuthMode = mode;
      const loginForm = document.getElementById('loginForm');
      const signupForm = document.getElementById('signupForm');
      const tabLogin = document.getElementById('tabAuthLogin');
      const tabSignup = document.getElementById('tabAuthSignup');

      if (mode === 'login') {
        if (loginForm) loginForm.classList.remove('hidden');
        if (signupForm) signupForm.classList.add('hidden');
        if (tabLogin) tabLogin.className = 'py-2.5 text-xs sm:text-sm font-semibold rounded-lg bg-emerald-500 text-slate-950 shadow transition';
        if (tabSignup) tabSignup.className = 'py-2.5 text-xs sm:text-sm font-semibold rounded-lg text-slate-400 hover:text-white transition';
        const emailEl = document.getElementById('loginEmail');
        if (emailEl) emailEl.focus();
      } else {
        if (signupForm) signupForm.classList.remove('hidden');
        if (loginForm) loginForm.classList.add('hidden');
        if (tabSignup) tabSignup.className = 'py-2.5 text-xs sm:text-sm font-semibold rounded-lg bg-emerald-500 text-slate-950 shadow transition';
        if (tabLogin) tabLogin.className = 'py-2.5 text-xs sm:text-sm font-semibold rounded-lg text-slate-400 hover:text-white transition';
        const nameEl = document.getElementById('signupName');
        if (nameEl) nameEl.focus();
      }
    }

    function togglePasswordVisibility(inputId, btnId) {
      const input = document.getElementById(inputId);
      const btn = document.getElementById(btnId);
      if (!input || !btn) return;
      if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = 'Hide';
      } else {
        input.type = 'password';
        btn.textContent = 'Show';
      }
    }

    function evaluatePasswordStrengthObj(pwd) {
      const str = String(pwd || '');
      let score = 0;
      if (str.length >= 8) score += 35;
      if (/[A-Z]/.test(str)) score += 20;
      if (/[0-9]/.test(str)) score += 20;
      if (/[^A-Za-z0-9]/.test(str)) score += 25;
      const capped = Math.min(100, score);
      const label = capped >= 80 ? 'Strong' : capped >= 50 ? 'Good' : 'Weak';
      return { score: capped, label, valid: str.length >= 8 };
    }

    function updatePasswordStrength(pwd) {
      const bar = document.getElementById('pwdStrengthBar');
      const label = document.getElementById('pwdStrengthText');
      const res = evaluatePasswordStrengthObj(pwd);
      if (bar) bar.style.width = res.score + '%';
      if (label) label.textContent = res.label;
      return res;
    }

    function triggerPasswordResetPrompt() {
      const email = document.getElementById('loginEmail').value || 'your email';
      showToast(`Password reset instructions queued for ${email} via Wydia SMTP relay.`);
    }

    async function quickLoginDemo(email) {
      const password = 'VasoolTest2026!';
      try {
        showToast(`⚡ Switching persona to ${email.split('@')[0]}...`);
        const res = await apiFetch('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password, name: email.split('@')[0] })
        });
        localStorage.setItem(AUTH_TOKEN_KEY, res.token);
        appState.currentUser = res.user;
        if (!appState.users.some((u) => u.email === res.user.email)) {
          appState.users.push(res.user);
        }
        showingAuthPortal = false;
        saveState();
        refreshAllViews();
        showToast(`👑 Active Persona: ${res.user.name}`);
        const selectEl = document.getElementById('personaQuickSelect');
        if (selectEl) selectEl.value = email;
        await syncWithBackend();
      } catch (err) {
        // Offline / Canvas standalone fallback for the 5 pre-configured test personas
        const demoPersonas = {
          'admin.aarav@vasool.test': { id: 'usr_aarav', name: 'Aarav Sharma (Admin)', email: 'admin.aarav@vasool.test', role: 'user', upiId: 'aarav@okaxis', isEmailVerified: true },
          'vikram.spender@vasool.test': { id: 'usr_vikram', name: 'Vikram Patel (Big Spender)', email: 'vikram.spender@vasool.test', role: 'user', upiId: 'vikram@okhdfc', isEmailVerified: true },
          'rohan.debtor@vasool.test': { id: 'usr_rohan', name: 'Rohan Gupta (Primary Debtor)', email: 'rohan.debtor@vasool.test', role: 'user', upiId: 'rohan@icici', isEmailVerified: true },
          'neha.couple@vasool.test': { id: 'usr_neha', name: 'Neha & Partner (Couple 2x)', email: 'neha.couple@vasool.test', role: 'user', upiId: 'neha@sbi', isEmailVerified: true },
          'priya.settler@vasool.test': { id: 'usr_priya', name: 'Priya Das (Settler)', email: 'priya.settler@vasool.test', role: 'user', upiId: 'priya@paytm', isEmailVerified: true }
        };
        const fallbackUser = demoPersonas[email.toLowerCase().trim()] || {
          id: 'usr_' + Date.now(),
          name: email.split('@')[0],
          email,
          role: 'user',
          isEmailVerified: true
        };
        localStorage.setItem(AUTH_TOKEN_KEY, 'demo-offline-token-' + fallbackUser.id);
        appState.currentUser = fallbackUser;
        showingAuthPortal = false;
        saveState();
        renderTopLevelView();
        refreshAllViews();
        showToast(`👑 Active Persona: ${fallbackUser.name}`);
      }
    }

    async function switchPersonaInApp(email) {
      if (!email) return;
      await quickLoginDemo(email);
    }

    async function handleEmailLogin(e) {
      e.preventDefault();
      const email = document.getElementById('loginEmail').value.trim().toLowerCase();
      const password = document.getElementById('loginPassword').value;

      const submitBtn = document.getElementById('btnSubmitLogin');
      const originalText = submitBtn ? submitBtn.innerHTML : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>Signing In...</span>';
      }

      try {
        const res = await apiFetch('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password })
        });

        if (res.requiresVerification) {
          openEmailVerificationModal(res.email || email);
          showToast(res.message || 'Please verify your email address to continue.', 'info');
          return;
        }

        localStorage.setItem(AUTH_TOKEN_KEY, res.token);
        appState.currentUser = res.user;
        if (!appState.users.some((u) => u.email === res.user.email)) {
          appState.users.push(res.user);
        }
        showingAuthPortal = false;
        saveState();
        switchMainTab('dashboard');
        refreshAllViews();
        showToast(res.message || `Welcome back, ${res.user.name}!`);
        await syncWithBackend();
        await checkAndProcessPendingJoin();
      } catch (err) {
        if (err.message && err.message.toLowerCase().includes('no account found')) {
          switchAuthTab('signup');
          const signupEmail = document.getElementById('signupEmail');
          const signupPwd = document.getElementById('signupPassword');
          if (signupEmail) signupEmail.value = email;
          if (signupPwd) signupPwd.value = password;
          showToast('No account found with this email. Switched to "Create Account" — enter your name to complete registration!', 'info');
          return;
        }
        if (err.data && err.data.requiresVerification) {
          openEmailVerificationModal(err.data.email || email);
          showToast(err.message || 'Please verify your email address to continue.', 'info');
          return;
        }
        if (err.data && err.data.error === 'account_suspended') {
          showToast(`🚫 ${err.message || 'Your account has been disabled by the administrator.'}`, 'error');
          return;
        }
        showToast(err.message || 'Authentication failed.', 'error');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalText;
        }
      }
    }

    async function handleEmailSignup(e) {
      e.preventDefault();
      const name = document.getElementById('signupName').value.trim();
      const email = document.getElementById('signupEmail').value.trim().toLowerCase();
      const password = document.getElementById('signupPassword').value;
      const upiId = (document.getElementById('signupUpi')?.value || '').trim();

      if (password.length < 8) {
        showToast('Password must be at least 8 characters long.', 'error');
        return;
      }

      const submitBtn = document.getElementById('btnSubmitSignup');
      const originalText = submitBtn ? submitBtn.innerHTML : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>Creating Account...</span>';
      }

      try {
        const res = await apiFetch('/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({ name, email, password, upiId })
        });

        if (res.requiresVerification) {
          openEmailVerificationModal(res.email || email);
          showToast(res.message || 'Verification code sent! Please verify your email.');
          return;
        }

        if (res.token) {
          localStorage.setItem(AUTH_TOKEN_KEY, res.token);
          appState.currentUser = res.user;
          if (!appState.users.some((u) => u.email === res.user.email)) {
            appState.users.push(res.user);
          }
          showingAuthPortal = false;
          saveState();
          switchMainTab('dashboard');
          refreshAllViews();
          showToast(`Welcome to Vasool, ${res.user.name}!`);
          await syncWithBackend();
          if (typeof openOnboardingWizard === 'function') openOnboardingWizard(0);
          await checkAndProcessPendingJoin();
        }
      } catch (err) {
        showToast(err.message || 'Account creation failed.', 'error');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalText;
        }
      }
    }

    let pendingVerificationEmail = '';
    let otpTimerInterval = null;
    let otpSecondsLeft = 900;
    let resendCooldownSeconds = 0;
    let resendCooldownInterval = null;

    function openEmailVerificationModal(email) {
      pendingVerificationEmail = email;
      const display = document.getElementById('verifyModalEmailDisplay');
      if (display) display.textContent = email;

      const input = document.getElementById('otpCodeInput');
      if (input) {
        input.value = '';
        setTimeout(() => input.focus(), 300);
      }

      clearInterval(otpTimerInterval);
      otpSecondsLeft = 900;
      updateOtpTimerDisplay();
      otpTimerInterval = setInterval(() => {
        otpSecondsLeft--;
        if (otpSecondsLeft <= 0) {
          clearInterval(otpTimerInterval);
          const timerEl = document.getElementById('otpCountdownTimer');
          if (timerEl) timerEl.textContent = 'Code expired';
        } else {
          updateOtpTimerDisplay();
        }
      }, 1000);

      startResendCooldown(60);
      openModal('emailVerificationModal');
    }

    function updateOtpTimerDisplay() {
      const timerEl = document.getElementById('otpCountdownTimer');
      if (!timerEl) return;
      const mins = Math.floor(otpSecondsLeft / 60);
      const secs = otpSecondsLeft % 60;
      timerEl.textContent = `Expires in ${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }

    function startResendCooldown(seconds = 60) {
      resendCooldownSeconds = seconds;
      const btn = document.getElementById('btnResendOtp');
      if (!btn) return;
      btn.disabled = true;

      clearInterval(resendCooldownInterval);
      resendCooldownInterval = setInterval(() => {
        resendCooldownSeconds--;
        if (resendCooldownSeconds <= 0) {
          clearInterval(resendCooldownInterval);
          btn.disabled = false;
          btn.textContent = 'Resend Code';
        } else {
          btn.textContent = `Resend in ${resendCooldownSeconds}s`;
        }
      }, 1000);
    }

    async function handleOtpVerificationSubmit(e) {
      e.preventDefault();
      const otpInput = document.getElementById('otpCodeInput');
      const otp = otpInput ? otpInput.value.trim() : '';

      if (!otp || otp.length !== 6) {
        showToast('Please enter the 6-digit verification code.', 'error');
        return;
      }

      const submitBtn = document.getElementById('btnSubmitOtp');
      const originalText = submitBtn ? submitBtn.innerHTML : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>Verifying...</span>';
      }

      try {
        const res = await apiFetch('/api/auth/verify-otp', {
          method: 'POST',
          body: JSON.stringify({ email: pendingVerificationEmail, otp })
        });

        localStorage.setItem(AUTH_TOKEN_KEY, res.token);
        appState.currentUser = res.user;
        if (!appState.users.some((u) => u.email === res.user.email)) {
          appState.users.push(res.user);
        }

        closeModal('emailVerificationModal');
        clearInterval(otpTimerInterval);
        clearInterval(resendCooldownInterval);

        showingAuthPortal = false;
        saveState();
        refreshAllViews();
        showToast(`🎉 ${res.message || 'Email verified successfully! Welcome to Vasool.'}`);
        await syncWithBackend();
        await checkAndProcessPendingJoin();
      } catch (err) {
        showToast(err.message || 'Verification failed. Please check the code.', 'error');
        if (otpInput) {
          otpInput.focus();
          otpInput.select();
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalText;
        }
      }
    }

    async function handleResendOtp() {
      if (!pendingVerificationEmail) return;
      const btn = document.getElementById('btnResendOtp');
      if (btn) btn.disabled = true;

      try {
        const res = await apiFetch('/api/auth/resend-otp', {
          method: 'POST',
          body: JSON.stringify({ email: pendingVerificationEmail })
        });

        showToast(res.message || 'A fresh verification code and link were sent to your email.');
        otpSecondsLeft = 900;
        updateOtpTimerDisplay();
        startResendCooldown(60);
      } catch (err) {
        showToast(err.message || 'Failed to resend code.', 'error');
        if (btn) btn.disabled = false;
      }
    }

    async function checkVerificationUrlParams() {
      if (typeof window === 'undefined' || !window.location) return;
      const params = new URLSearchParams(window.location.search);

      if (params.get('verified') === 'true' && params.get('token')) {
        const token = params.get('token');
        localStorage.setItem(AUTH_TOKEN_KEY, token);
        window.history.replaceState({}, document.title, window.location.pathname);

        try {
          const meRes = await apiFetch('/api/auth/me');
          if (meRes && meRes.user) {
            appState.currentUser = meRes.user;
            if (!appState.users.some((u) => u.email === meRes.user.email)) {
              appState.users.push(meRes.user);
            }
            showingAuthPortal = false;
            saveState();
            refreshAllViews();
            showToast('🎉 Email verified successfully via Magic Link! Welcome to Vasool.');
            await syncWithBackend();
            await checkAndProcessPendingJoin();
          }
        } catch (err) {
          console.warn('[Magic Link Auth] Error loading user profile:', err);
        }
        return;
      }

      if (params.get('resetToken')) {
        const resetToken = params.get('resetToken');
        const email = params.get('email') || '';
        window.history.replaceState({}, document.title, window.location.pathname);

        const emailDisplay = document.getElementById('forgotPwEmailDisplay');
        const tokenInput = document.getElementById('forgotPwResetToken');
        const emailInput = document.getElementById('forgotPwEmail');
        if (emailDisplay) emailDisplay.textContent = email;
        if (emailInput) emailInput.value = email;
        if (tokenInput) tokenInput.value = resetToken;

        switchForgotPwStep(2);
        openModal('forgotPasswordModal');
        showToast('🔑 Magic reset link recognized. Please enter your new password.');
        return;
      }

      if (params.get('verifyError')) {
        const errorType = params.get('verifyError');
        const email = params.get('email') || '';
        window.history.replaceState({}, document.title, window.location.pathname);

        if (errorType === 'expired_token') {
          showToast('Verification link has expired. A fresh code can be requested.', 'error');
          if (email) openEmailVerificationModal(email);
        } else if (errorType === 'invalid_token') {
          showToast('Invalid verification link. Please check your email or request a new code.', 'error');
        } else {
          showToast('Email verification link could not be validated. Please try again.', 'error');
        }
      }
    }

    // =========================================================================
    // FORGOT PASSWORD (EMAIL OTP & MAGIC LINK) HANDLERS
    // =========================================================================
    let forgotPwSecondsLeft = 900;
    let forgotPwTimerInterval = null;
    let forgotResendCooldownSeconds = 0;
    let forgotResendCooldownInterval = null;

    function openForgotPasswordModal() {
      const currentEmail = (document.getElementById('loginEmail')?.value || document.getElementById('signupEmail')?.value || '').trim();
      const emailInput = document.getElementById('forgotPwEmail');
      if (emailInput && currentEmail) {
        emailInput.value = currentEmail;
      }
      switchForgotPwStep(1);
      openModal('forgotPasswordModal');
    }

    function switchForgotPwStep(step) {
      const step1 = document.getElementById('forgotPwStep1');
      const step2 = document.getElementById('forgotPwStep2');
      if (step === 1) {
        if (step1) step1.classList.remove('hidden');
        if (step2) step2.classList.add('hidden');
        clearInterval(forgotPwTimerInterval);
        clearInterval(forgotResendCooldownInterval);
      } else {
        if (step1) step1.classList.add('hidden');
        if (step2) step2.classList.remove('hidden');
        const otpInput = document.getElementById('forgotPwOtp');
        if (otpInput) {
          otpInput.value = '';
          setTimeout(() => otpInput.focus(), 300);
        }
      }
    }

    function updateForgotPwdStrength(pwd) {
      const bar = document.getElementById('forgotPwdStrengthBar');
      const label = document.getElementById('forgotPwdStrengthText');
      const res = evaluatePasswordStrengthObj(pwd);
      if (bar) bar.style.width = res.score + '%';
      if (label) label.textContent = res.label;
      return res;
    }

    function updateChangePwdStrength(pwd) {
      const bar = document.getElementById('changePwdStrengthBar');
      const label = document.getElementById('changePwdStrengthText');
      const res = evaluatePasswordStrengthObj(pwd);
      if (bar) bar.style.width = res.score + '%';
      if (label) label.textContent = res.label;
      return res;
    }

    function startForgotResendCooldown(seconds = 60) {
      forgotResendCooldownSeconds = seconds;
      const btn = document.getElementById('btnResendForgotPwOtp');
      if (!btn) return;
      btn.disabled = true;

      clearInterval(forgotResendCooldownInterval);
      forgotResendCooldownInterval = setInterval(() => {
        forgotResendCooldownSeconds--;
        if (forgotResendCooldownSeconds <= 0) {
          clearInterval(forgotResendCooldownInterval);
          btn.disabled = false;
          btn.textContent = 'Resend Code';
        } else {
          btn.textContent = `Resend in ${forgotResendCooldownSeconds}s`;
        }
      }, 1000);
    }

    function updateForgotCountdownDisplay() {
      const timerEl = document.getElementById('forgotPwCountdownTimer');
      if (!timerEl) return;
      const mins = Math.floor(forgotPwSecondsLeft / 60);
      const secs = forgotPwSecondsLeft % 60;
      timerEl.textContent = `Expires in ${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }

    async function handleSendPasswordReset(e) {
      e.preventDefault();
      const email = document.getElementById('forgotPwEmail').value.trim().toLowerCase();
      if (!email) {
        showToast('Please enter your email address.', 'error');
        return;
      }

      const submitBtn = document.getElementById('btnSendForgotPw');
      const originalText = submitBtn ? submitBtn.innerHTML : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>Sending Code...</span>';
      }

      try {
        const res = await apiFetch('/api/auth/forgot-password', {
          method: 'POST',
          body: JSON.stringify({ email })
        });

        const displayEl = document.getElementById('forgotPwEmailDisplay');
        if (displayEl) displayEl.textContent = email;

        switchForgotPwStep(2);
        showToast(res.message || 'Password reset code and link have been sent to your email.');

        clearInterval(forgotPwTimerInterval);
        forgotPwSecondsLeft = 900;
        updateForgotCountdownDisplay();
        forgotPwTimerInterval = setInterval(() => {
          forgotPwSecondsLeft--;
          if (forgotPwSecondsLeft <= 0) {
            clearInterval(forgotPwTimerInterval);
            const timerEl = document.getElementById('forgotPwCountdownTimer');
            if (timerEl) timerEl.textContent = 'Code expired';
          } else {
            updateForgotCountdownDisplay();
          }
        }, 1000);

        startForgotResendCooldown(60);
      } catch (err) {
        showToast(err.message || 'Failed to send password reset code.', 'error');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalText;
        }
      }
    }

    async function handleResendForgotPwOtp() {
      const email = (document.getElementById('forgotPwEmailDisplay')?.textContent || document.getElementById('forgotPwEmail')?.value || '').trim();
      if (!email) return;

      const btn = document.getElementById('btnResendForgotPwOtp');
      if (btn) btn.disabled = true;

      try {
        const res = await apiFetch('/api/auth/forgot-password', {
          method: 'POST',
          body: JSON.stringify({ email })
        });
        showToast(res.message || 'A fresh reset code has been sent to your email.');
        forgotPwSecondsLeft = 900;
        updateForgotCountdownDisplay();
        startForgotResendCooldown(60);
      } catch (err) {
        showToast(err.message || 'Failed to resend code.', 'error');
        if (btn) btn.disabled = false;
      }
    }

    async function handleExecutePasswordReset(e) {
      e.preventDefault();
      const email = (document.getElementById('forgotPwEmailDisplay')?.textContent || document.getElementById('forgotPwEmail')?.value || '').trim().toLowerCase();
      const otp = document.getElementById('forgotPwOtp').value.trim();
      const token = document.getElementById('forgotPwResetToken').value.trim();
      const newPassword = document.getElementById('forgotPwNewPassword').value;
      const confirmPassword = document.getElementById('forgotPwConfirmPassword').value;

      if (!otp && !token) {
        showToast('Please enter the 6-digit reset code from your email.', 'error');
        return;
      }
      if (newPassword.length < 8) {
        showToast('New password must be at least 8 characters long.', 'error');
        return;
      }
      if (newPassword !== confirmPassword) {
        showToast('Passwords do not match. Please re-enter.', 'error');
        return;
      }

      const submitBtn = document.getElementById('btnSubmitResetPw');
      const originalText = submitBtn ? submitBtn.innerHTML : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>Updating Password...</span>';
      }

      try {
        const res = await apiFetch('/api/auth/reset-password', {
          method: 'POST',
          body: JSON.stringify({ email, otp: otp || undefined, token: token || undefined, newPassword })
        });

        closeModal('forgotPasswordModal');
        clearInterval(forgotPwTimerInterval);
        clearInterval(forgotResendCooldownInterval);

        localStorage.setItem(AUTH_TOKEN_KEY, res.token);
        appState.currentUser = res.user;
        if (!appState.users.some((u) => u.email === res.user.email)) {
          appState.users.push(res.user);
        }
        showingAuthPortal = false;
        saveState();
        refreshAllViews();
        showToast(`🎉 ${res.message || 'Password reset successfully! Welcome to Vasool.'}`);
        await syncWithBackend();
        await checkAndProcessPendingJoin();
      } catch (err) {
        showToast(err.message || 'Password reset failed.', 'error');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalText;
        }
      }
    }

    // =========================================================================
    // ACCOUNT SETTINGS & PASSWORD CHANGE HANDLERS
    // =========================================================================
    function openAccountSettingsModal() {
      const user = appState.currentUser;
      if (!user) {
        showToast('Please log in to manage your account settings.', 'error');
        return;
      }

      const avatarEl = document.getElementById('settingsProfileAvatar');
      const nameEl = document.getElementById('settingsProfileName');
      const emailEl = document.getElementById('settingsProfileEmail');
      const upiEl = document.getElementById('settingsProfileUpi');
      const badgeEl = document.getElementById('settingsVerifiedBadge');
      const superBadgeEl = document.getElementById('settingsSuperAdminBadge');
      const roleEl = document.getElementById('settingsProfileRole');

      const isSuper = user.isSuperAdmin || user.role === 'super_admin' || (user.email && user.email.toLowerCase() === 'mdzubair7592@gmail.com');

      if (nameEl) nameEl.textContent = user.name || 'User';
      if (emailEl) emailEl.textContent = user.email || '';
      if (upiEl) upiEl.textContent = user.upiId ? `UPI: ${user.upiId}` : 'UPI Handle: Not configured';
      if (roleEl) {
        if (isSuper) {
          roleEl.innerHTML = '<span class="text-amber-400 font-semibold">Role: Super Admin (App Owner)</span>';
        } else {
          roleEl.textContent = 'Role: Member';
        }
      }

      if (avatarEl) {
        const initials = (user.name || user.email || 'U')
          .split(' ')
          .map((w) => w[0])
          .join('')
          .slice(0, 2)
          .toUpperCase();
        avatarEl.textContent = initials;
        if (isSuper) {
          avatarEl.className = 'w-11 h-11 rounded-full bg-gradient-to-br from-amber-500/30 to-yellow-500/30 border-2 border-amber-400 flex items-center justify-center text-sm font-extrabold text-amber-300 flex-shrink-0 shadow-lg shadow-amber-500/20';
        } else {
          avatarEl.className = 'w-11 h-11 rounded-full bg-gradient-to-br from-emerald-500/30 to-teal-500/30 border border-emerald-400/40 flex items-center justify-center text-sm font-bold text-emerald-300 flex-shrink-0';
        }
      }
      if (badgeEl) {
        if (user.isEmailVerified !== false) {
          badgeEl.className = 'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
          badgeEl.textContent = '✓ Verified';
        } else {
          badgeEl.className = 'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30';
          badgeEl.textContent = '⚠️ Unverified';
        }
      }
      if (superBadgeEl) {
        if (isSuper) {
          superBadgeEl.classList.remove('hidden');
        } else {
          superBadgeEl.classList.add('hidden');
        }
      }

      const superCard = document.getElementById('settingsSuperAdminCard');
      if (superCard) {
        if (isSuper) {
          superCard.classList.remove('hidden');
        } else {
          superCard.classList.add('hidden');
        }
      }

      const nameInp = document.getElementById('settingsNameInput');
      const upiInp = document.getElementById('settingsUpiInput');
      const upiStatusBadge = document.getElementById('settingsUpiStatusBadge');
      if (nameInp) nameInp.value = user.name || '';
      if (upiInp) upiInp.value = user.upiId || '';
      if (upiStatusBadge) {
        if (user.upiId && String(user.upiId).trim()) {
          upiStatusBadge.className = 'text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold';
          upiStatusBadge.textContent = '✓ UPI Active';
        } else {
          upiStatusBadge.className = 'text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 font-semibold';
          upiStatusBadge.textContent = 'No UPI Linked';
        }
      }

      const curr = document.getElementById('settingsCurrentPassword');
      const nw = document.getElementById('settingsNewPassword');
      const conf = document.getElementById('settingsConfirmPassword');
      if (curr) curr.value = '';
      if (nw) nw.value = '';
      if (conf) conf.value = '';
      const bar = document.getElementById('changePwdStrengthBar');
      const lbl = document.getElementById('changePwdStrengthText');
      if (bar) bar.style.width = '0%';
      if (lbl) lbl.textContent = 'Weak';

      openModal('accountSettingsModal');
    }

    function clearProfileUpiField() {
      const upiInp = document.getElementById('settingsUpiInput');
      if (upiInp) {
        upiInp.value = '';
        upiInp.focus();
      }
    }

    async function handleUpdateProfileUpiSubmit(e) {
      e.preventDefault();
      if (!appState.currentUser) return;

      const nameInp = document.getElementById('settingsNameInput');
      const upiInp = document.getElementById('settingsUpiInput');
      const newName = (nameInp ? nameInp.value.trim() : '') || appState.currentUser.name;
      const newUpi = upiInp ? upiInp.value.trim() : '';

      if (newUpi && (!newUpi.includes('@') || /\s/.test(newUpi) || newUpi.length < 4)) {
        showToast('Please enter a valid UPI ID (e.g. yourname@okaxis) or leave blank to disable UPI redirect.', 'error');
        return;
      }

      const btn = document.getElementById('btnSaveProfileUpi');
      const origHtml = btn ? btn.innerHTML : '';
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span>Saving Profile & UPI...</span>';
      }

      try {
        if (localStorage.getItem(AUTH_TOKEN_KEY)) {
          const res = await apiFetch('/api/auth/profile', {
            method: 'PATCH',
            body: JSON.stringify({ name: newName, upiId: newUpi })
          });
          if (res && res.user) {
            appState.currentUser = { ...appState.currentUser, ...res.user };
          }
        }

        // Sync in-memory user & group member records immediately
        appState.currentUser.name = newName;
        appState.currentUser.upiId = newUpi;
        const myEmail = (appState.currentUser.email || '').toLowerCase().trim();
        (appState.groups || []).forEach((g) => {
          (g.members || []).forEach((m) => {
            if ((m.email || '').toLowerCase().trim() === myEmail) {
              m.upiId = newUpi;
              m.name = newName;
            }
          });
        });
        (appState.users || []).forEach((u) => {
          if ((u.email || '').toLowerCase().trim() === myEmail) {
            u.upiId = newUpi;
            u.name = newName;
          }
        });

        saveState();
        refreshAllViews();

        // Refresh modal badges
        const nameEl = document.getElementById('settingsProfileName');
        const upiEl = document.getElementById('settingsProfileUpi');
        const upiStatusBadge = document.getElementById('settingsUpiStatusBadge');
        if (nameEl) nameEl.textContent = newName;
        if (upiEl) upiEl.textContent = newUpi ? `UPI: ${newUpi}` : 'UPI Handle: Not configured';
        if (upiStatusBadge) {
          if (newUpi) {
            upiStatusBadge.className = 'text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold';
            upiStatusBadge.textContent = '✓ UPI Active';
          } else {
            upiStatusBadge.className = 'text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 font-semibold';
            upiStatusBadge.textContent = 'No UPI Linked';
          }
        }

        showToast(newUpi ? `✅ UPI ID updated to ${newUpi}!` : '✅ UPI ID cleared. Direct UPI redirect is now hidden for payers.');
      } catch (err) {
        showToast(err.message || 'Failed to update profile & UPI ID.', 'error');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = origHtml;
        }
      }
    }

    async function handleChangePasswordSubmit(e) {
      e.preventDefault();
      const currentPassword = document.getElementById('settingsCurrentPassword').value;
      const newPassword = document.getElementById('settingsNewPassword').value;
      const confirmPassword = document.getElementById('settingsConfirmPassword').value;

      if (newPassword.length < 8) {
        showToast('New password must be at least 8 characters long.', 'error');
        return;
      }
      if (newPassword !== confirmPassword) {
        showToast('New password and confirmation do not match.', 'error');
        return;
      }

      const submitBtn = document.getElementById('btnSubmitChangePassword');
      const originalText = submitBtn ? submitBtn.innerHTML : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>Updating Password...</span>';
      }

      try {
        const res = await apiFetch('/api/auth/change-password', {
          method: 'POST',
          body: JSON.stringify({ currentPassword, newPassword })
        });

        closeModal('accountSettingsModal');
        showToast(`✅ ${res.message || 'Password changed successfully.'}`);
      } catch (err) {
        showToast(err.message || 'Failed to change password.', 'error');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalText;
        }
      }
    }

    // =========================================================================
    // SUPER ADMIN CONSOLE LOGIC (VIEW/EDIT PASSWORDS, DISABLE/DELETE ACCOUNTS)
    // =========================================================================
    let adminUsersCache = [];
    let revealedPasswords = {};

    function openSuperAdminConsole() {
      const isSuper = (typeof isSuperAdminUser === 'function')
        ? isSuperAdminUser(appState.currentUser)
        : Boolean(appState.currentUser && (appState.currentUser.isSuperAdmin || appState.currentUser.role === 'super_admin' || (appState.currentUser.email && appState.currentUser.email.toLowerCase() === 'mdzubair7592@gmail.com')));

      if (!isSuper) {
        showToast('Access restricted: Super Admin credentials required.', 'error');
        return;
      }
      switchMainTab('admin');
    }

    async function fetchAdminSettings() {
      try {
        const res = await apiFetch('/api/admin/settings');
        if (res && res.settings) {
          const s = res.settings;
          const badge = document.getElementById('adminSessionActiveBadge');
          const presetSelect = document.getElementById('adminSessionPresetSelect');
          const customVal = document.getElementById('adminCustomDurationValue');
          const customUnit = document.getElementById('adminCustomDurationUnit');
          const customCont = document.getElementById('adminCustomDurationContainer');

          const str = s.sessionDurationString || `${s.sessionDurationValue}${s.sessionDurationUnit === 'hours' ? 'h' : 'd'}`;
          if (badge) {
            badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span> Active: ${s.sessionDurationValue} ${s.sessionDurationUnit} (${str})`;
          }

          // Check if matches preset
          const presets = ['7d', '14d', '30d', '90d', '180d', '365d'];
          if (presets.includes(str)) {
            if (presetSelect) presetSelect.value = str;
            if (customCont) customCont.classList.add('hidden');
          } else {
            if (presetSelect) presetSelect.value = 'custom';
            if (customCont) customCont.classList.remove('hidden');
          }

          if (customVal) customVal.value = s.sessionDurationValue;
          if (customUnit) customUnit.value = s.sessionDurationUnit || 'days';
        }
      } catch (err) {
        console.warn('[Admin Settings] Failed to fetch settings:', err);
      }
    }

    function handlePresetSessionChange(val) {
      const customCont = document.getElementById('adminCustomDurationContainer');
      const customVal = document.getElementById('adminCustomDurationValue');
      const customUnit = document.getElementById('adminCustomDurationUnit');
      if (val === 'custom') {
        if (customCont) customCont.classList.remove('hidden');
      } else {
        if (customCont) customCont.classList.add('hidden');
        if (val.endsWith('d')) {
          if (customVal) customVal.value = parseInt(val, 10);
          if (customUnit) customUnit.value = 'days';
        } else if (val.endsWith('h')) {
          if (customVal) customVal.value = parseInt(val, 10);
          if (customUnit) customUnit.value = 'hours';
        }
      }
    }

    async function saveAdminSessionConfig() {
      const presetSelect = document.getElementById('adminSessionPresetSelect');
      const customVal = document.getElementById('adminCustomDurationValue');
      const customUnit = document.getElementById('adminCustomDurationUnit');
      const btn = document.getElementById('btnSaveSessionConfig');
      const btnText = document.getElementById('btnSaveSessionText');

      let val = 7;
      let unit = 'days';

      const preset = presetSelect ? presetSelect.value : '7d';
      if (preset === 'custom') {
        val = parseInt(customVal ? customVal.value : '7', 10);
        unit = customUnit ? customUnit.value : 'days';
      } else if (preset.endsWith('d')) {
        val = parseInt(preset, 10);
        unit = 'days';
      } else if (preset.endsWith('h')) {
        val = parseInt(preset, 10);
        unit = 'hours';
      }

      if (isNaN(val) || val <= 0) {
        showToast('Please enter a valid positive duration value.', 'error');
        return;
      }
      if (unit === 'days' && (val < 1 || val > 365)) {
        showToast('Duration in days must be between 1 and 365 days.', 'error');
        return;
      }
      if (unit === 'hours' && (val < 1 || val > 8760)) {
        showToast('Duration in hours must be between 1 and 8760 hours.', 'error');
        return;
      }

      const origText = btnText ? btnText.textContent : 'Save Lifetime';
      if (btn) btn.disabled = true;
      if (btnText) btnText.textContent = 'Saving...';

      try {
        const res = await apiFetch('/api/admin/settings', {
          method: 'PATCH',
          body: JSON.stringify({
            sessionDurationValue: val,
            sessionDurationUnit: unit
          })
        });

        showToast(`✅ ${res.message || 'Session configuration saved!'}`);
        await fetchAdminSettings();
      } catch (err) {
        showToast(err.message || 'Failed to save session settings.', 'error');
      } finally {
        if (btn) btn.disabled = false;
        if (btnText) btnText.textContent = origText;
      }
    }

    async function fetchAdminUsers() {
      // Also fetch session duration settings when opening console
      fetchAdminSettings();

      const container = document.getElementById('adminUsersListContainer');
      if (container) {
        container.innerHTML = `
          <div class="text-center py-10 text-slate-500 text-xs flex items-center justify-center gap-2">
            <span class="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin"></span>
            <span>Fetching live accounts from MongoDB Atlas...</span>
          </div>`;
      }

      try {
        const res = await apiFetch('/api/admin/users');
        adminUsersCache = res.users || [];

        // Update stats
        const totalEl = document.getElementById('adminTotalUsersStat');
        const activeEl = document.getElementById('adminActiveUsersStat');
        const suspEl = document.getElementById('adminSuspendedUsersStat');

        const total = adminUsersCache.length;
        const suspended = adminUsersCache.filter((u) => u.isSuspended).length;
        const active = total - suspended;

        if (totalEl) totalEl.textContent = total;
        if (activeEl) activeEl.textContent = active;
        if (suspEl) suspEl.textContent = suspended;
        const subTabUsersCount = document.getElementById('adminSubTabUsersCount');
        if (subTabUsersCount) subTabUsersCount.textContent = total;
        fetchAdminGroups(true);
        fetchAdminFeedback(true);

        const searchVal = document.getElementById('adminUserSearchInput') ? document.getElementById('adminUserSearchInput').value : '';
        filterAdminUsers(searchVal);
      } catch (err) {
        if (container) {
          container.innerHTML = `
            <div class="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs text-center">
              Failed to load accounts: ${escapeHtml(err.message || 'Access restricted')}
            </div>`;
        }
        showToast(err.message || 'Failed to fetch admin users.', 'error');
      }
    }

    function filterAdminUsers(query) {
      const q = String(query || '').trim().toLowerCase();
      const statusSelect = document.getElementById('adminStatusFilter');
      const statusFilter = statusSelect ? statusSelect.value : 'ALL';

      let filtered = adminUsersCache;
      if (statusFilter === 'ACTIVE') {
        filtered = filtered.filter((u) => !u.isSuspended);
      } else if (statusFilter === 'DISABLED') {
        filtered = filtered.filter((u) => u.isSuspended);
      }

      if (q) {
        filtered = filtered.filter((u) =>
          (u.name && u.name.toLowerCase().includes(q)) ||
          (u.email && u.email.toLowerCase().includes(q))
        );
      }
      renderAdminUsers(filtered);
    }

    function togglePasswordReveal(userId) {
      revealedPasswords[userId] = !revealedPasswords[userId];
      const searchVal = document.getElementById('adminUserSearchInput') ? document.getElementById('adminUserSearchInput').value : '';
      filterAdminUsers(searchVal);
    }

    function renderAdminUsers(users) {
      const container = document.getElementById('adminUsersListContainer');
      if (!container) return;

      if (!users || users.length === 0) {
        container.innerHTML = `
          <div class="text-center py-10 text-slate-500 text-xs">
            No accounts found matching your query.
          </div>`;
        return;
      }

      const html = users.map((u) => {
        const initials = (u.name || u.email || 'U').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
        const isSuper = Boolean(u.isSuperAdmin) || (u.email && u.email.toLowerCase() === 'mdzubair7592@gmail.com');
        const isRevealed = Boolean(revealedPasswords[u.id]);
        const passwordDisplay = isRevealed ? escapeHtml(u.password) : '••••••••••••';

        let statusBadge = '';
        if (u.isSuspended) {
          if (u.suspendedUntil) {
            const untilDate = new Date(u.suspendedUntil);
            const dateStr = untilDate.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            statusBadge = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40" title="Reason: ${escapeHtml(u.suspensionReason || 'Disabled')}">⏳ Disabled until ${dateStr}</span>`;
          } else {
            statusBadge = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40" title="Reason: ${escapeHtml(u.suspensionReason || 'Disabled')}">🚫 Disabled (Indefinite)</span>`;
          }
        } else {
          statusBadge = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">✓ Active</span>`;
        }

        const roleBadge = isSuper
          ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-extrabold bg-amber-500/20 text-amber-300 border border-amber-400/50">👑 Super Admin</span>`
          : `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-800 text-slate-400 border border-slate-700">Member</span>`;

        const verifiedBadge = u.isEmailVerified
          ? `<span class="text-[10px] text-emerald-400" title="Email verified">✓ Verified</span>`
          : `<span class="text-[10px] text-amber-400" title="Verification pending">⚠️ Unverified</span>`;

        // Action controls
        let actionButtons = '';
        if (isSuper) {
          actionButtons = `
            <div class="w-full sm:w-auto px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-400/30 text-[11px] font-bold text-amber-300 flex items-center justify-center sm:justify-start gap-1 whitespace-nowrap">
              <span>🛡️</span> Protected App Owner
            </div>`;
        } else {
          const suspendToggleBtn = u.isSuspended
            ? `<button onclick="executeAdminUnsuspend('${u.id}', '${escapeHtml(u.email)}')" class="flex-1 sm:flex-initial px-2.5 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-xs font-semibold transition flex items-center justify-center gap-1 whitespace-nowrap">
                 <span>✅</span> Re-enable
               </button>`
            : `<button onclick="openAdminSuspendModal('${u.id}', '${escapeHtml(u.name)}', '${escapeHtml(u.email)}')" class="flex-1 sm:flex-initial px-2.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-semibold transition flex items-center justify-center gap-1 whitespace-nowrap">
                 <span>🚫</span> Disable
               </button>`;

          actionButtons = `
            <div class="grid grid-cols-3 sm:flex items-center gap-1.5 w-full sm:w-auto">
              <button onclick="openAdminEditPasswordModal('${u.id}', '${escapeHtml(u.name)}', '${escapeHtml(u.email)}')" class="flex-1 sm:flex-initial px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition flex items-center justify-center gap-1 whitespace-nowrap" title="Change user password">
                <span>✏️</span> Edit Pwd
              </button>
              ${suspendToggleBtn}
              <button onclick="openAdminDeleteUserModal('${u.id}', '${escapeHtml(u.name)}', '${escapeHtml(u.email)}')" class="flex-1 sm:flex-initial px-2 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-xs font-semibold transition flex items-center justify-center gap-1 whitespace-nowrap" title="Delete account">
                <span>🗑️</span> Delete
              </button>
            </div>`;
        }

        return `
          <div class="p-3.5 sm:p-4 rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-slate-700 transition space-y-3 w-full max-w-full overflow-hidden">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div class="flex items-start sm:items-center gap-3 min-w-0 flex-1">
                <div class="w-10 h-10 rounded-full ${isSuper ? 'bg-amber-500/20 border-2 border-amber-400 text-amber-300' : 'bg-slate-800 border border-slate-700 text-slate-300'} flex items-center justify-center font-bold text-xs flex-shrink-0">
                  ${initials}
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                    <span class="text-sm font-bold text-white break-words">${escapeHtml(u.name || 'User')}</span>
                    ${roleBadge}
                    ${statusBadge}
                  </div>
                  <div class="flex items-center gap-1.5 text-xs text-slate-400 mt-1 flex-wrap">
                    <span class="font-mono text-emerald-400/90 break-all">${escapeHtml(u.email)}</span>
                    <span class="text-slate-600">&bull;</span>
                    ${verifiedBadge}
                    <span class="text-slate-600">&bull;</span>
                    <span class="whitespace-nowrap">${u.groupCount || 0} groups</span>
                  </div>
                </div>
              </div>
              <div class="w-full sm:w-auto pt-2 sm:pt-0 border-t border-slate-800/60 sm:border-t-0">
                ${actionButtons}
              </div>
            </div>

            <!-- Password & Details Row -->
            <div class="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs w-full max-w-full overflow-hidden">
              <div class="flex items-center gap-2 flex-wrap min-w-0 flex-1">
                <span class="text-slate-500 font-medium whitespace-nowrap">Password:</span>
                <span class="font-mono break-all ${isRevealed ? 'text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/30 font-semibold' : 'text-slate-400'}">${passwordDisplay}</span>
                <button type="button" onclick="togglePasswordReveal('${u.id}')" class="text-[11px] text-slate-400 hover:text-white px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 transition whitespace-nowrap flex-shrink-0">
                  ${isRevealed ? 'Hide' : '👁️ Reveal'}
                </button>
              </div>
              <div class="text-[11px] text-slate-500 whitespace-nowrap pt-1 sm:pt-0 sm:text-right">
                Joined: ${new Date(u.createdAt).toLocaleDateString()}
              </div>
            </div>
          </div>`;
      }).join('');

      container.innerHTML = html;
    }

    function openAdminEditPasswordModal(userId, userName, userEmail) {
      document.getElementById('adminEditPasswordUserId').value = userId;
      document.getElementById('adminEditPasswordUserSubtitle').textContent = `${userName} (${userEmail})`;
      document.getElementById('adminEditPasswordInput').value = '';
      openModal('adminEditPasswordModal');
    }

    async function submitAdminEditPassword(e) {
      e.preventDefault();
      const userId = document.getElementById('adminEditPasswordUserId').value;
      const newPassword = document.getElementById('adminEditPasswordInput').value;

      if (!newPassword || newPassword.length < 4) {
        showToast('Password must be at least 4 characters long.', 'error');
        return;
      }

      const btn = document.getElementById('btnAdminSavePassword');
      const origText = btn ? btn.textContent : '';
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Saving...';
      }

      try {
        const res = await apiFetch(`/api/admin/users/${userId}/password`, {
          method: 'PUT',
          body: JSON.stringify({ newPassword })
        });
        closeModal('adminEditPasswordModal');
        showToast(`✅ ${res.message || 'Password updated successfully!'}`);
        await fetchAdminUsers();
      } catch (err) {
        showToast(err.message || 'Failed to update user password.', 'error');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = origText;
        }
      }
    }

    function openAdminSuspendModal(userId, userName, userEmail) {
      document.getElementById('adminSuspendUserId').value = userId;
      document.getElementById('adminSuspendUserSubtitle').textContent = `${userName} (${userEmail})`;
      document.getElementById('adminSuspendDurationSelect').value = '24';
      document.getElementById('adminCustomTimeContainer').classList.add('hidden');
      document.getElementById('adminCustomUntilInput').value = '';
      document.getElementById('adminSuspendReasonInput').value = '';
      openModal('adminSuspendModal');
    }

    function handleSuspendDurationChange(val) {
      const customContainer = document.getElementById('adminCustomTimeContainer');
      if (customContainer) {
        if (val === 'custom') {
          customContainer.classList.remove('hidden');
        } else {
          customContainer.classList.add('hidden');
        }
      }
    }

    async function submitAdminSuspend(e) {
      e.preventDefault();
      const userId = document.getElementById('adminSuspendUserId').value;
      const durationChoice = document.getElementById('adminSuspendDurationSelect').value;
      const reason = document.getElementById('adminSuspendReasonInput').value;

      let payload = { action: 'suspend', reason };

      if (durationChoice === 'custom') {
        const customUntil = document.getElementById('adminCustomUntilInput').value;
        if (!customUntil) {
          showToast('Please select a custom date and time.', 'error');
          return;
        }
        payload.customUntil = new Date(customUntil).toISOString();
      } else if (durationChoice === 'indefinite') {
        // null / indefinite
      } else {
        payload.durationHours = Number(durationChoice);
      }

      const btn = document.getElementById('btnAdminConfirmSuspend');
      const origText = btn ? btn.textContent : '';
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Disabling...';
      }

      try {
        const res = await apiFetch(`/api/admin/users/${userId}/status`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
        closeModal('adminSuspendModal');
        showToast(`🚫 ${res.message || 'Account disabled.'}`);
        await fetchAdminUsers();
      } catch (err) {
        showToast(err.message || 'Failed to disable account.', 'error');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = origText;
        }
      }
    }

    async function executeAdminUnsuspend(userId, userEmail) {
      try {
        const res = await apiFetch(`/api/admin/users/${userId}/status`, {
          method: 'PUT',
          body: JSON.stringify({ action: 'unsuspend' })
        });
        showToast(`✅ ${res.message || 'Account re-enabled!'}`);
        await fetchAdminUsers();
      } catch (err) {
        showToast(err.message || 'Failed to re-enable account.', 'error');
      }
    }

    function openAdminDeleteUserModal(userId, userName, userEmail) {
      document.getElementById('adminDeleteUserId').value = userId;
      document.getElementById('adminDeleteUserName').textContent = userName;
      document.getElementById('adminDeleteUserEmail').textContent = userEmail;
      openModal('adminDeleteUserModal');
    }

    async function submitAdminDeleteUser() {
      const userId = document.getElementById('adminDeleteUserId').value;
      const btn = document.getElementById('btnAdminConfirmDelete');
      const origText = btn ? btn.textContent : '';
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Deleting...';
      }

      try {
        const res = await apiFetch(`/api/admin/users/${userId}`, {
          method: 'DELETE'
        });
        closeModal('adminDeleteUserModal');
        showToast(`🗑️ ${res.message || 'Account deleted.'}`);
        await fetchAdminUsers();
      } catch (err) {
        showToast(err.message || 'Failed to delete account.', 'error');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = origText;
        }
      }
    }

    // =========================================================================
    // USER FEEDBACK & COMMENTS CLIENT LOGIC
    // =========================================================================
    let currentFeedbackRating = null;

    function openFeedbackModal() {
      // Pre-fill user state
      const identityText = document.getElementById('feedbackUserIdentityText');
      const anonCheckbox = document.getElementById('feedbackAnonymousCheckbox');
      if (anonCheckbox) anonCheckbox.checked = false;

      if (appState.currentUser && appState.currentUser.email) {
        const displayName = appState.currentUser.fullName || appState.currentUser.name || appState.currentUser.email;
        if (identityText) identityText.textContent = `Submitting as: ${displayName} (${appState.currentUser.email})`;
      } else {
        if (identityText) identityText.textContent = 'Submitting as: Anonymous Guest';
      }

      // Reset fields
      selectFeedbackType('general');
      setFeedbackRating(null);
      const msgInput = document.getElementById('feedbackMessageInput');
      if (msgInput) {
        msgInput.value = '';
        updateFeedbackCharCount(msgInput);
      }

      openModal('feedbackModal');
    }

    function selectFeedbackType(type) {
      const typeInput = document.getElementById('selectedFeedbackType');
      if (typeInput) typeInput.value = type;

      const types = ['feature', 'bug', 'ux', 'general'];
      types.forEach((t) => {
        const btn = document.getElementById(`feedbackTypeBtn_${t}`);
        if (!btn) return;
        if (t === type) {
          btn.className = 'feedback-type-btn p-2 rounded-xl text-xs font-medium border border-emerald-500 bg-emerald-500/15 text-emerald-300 flex flex-col items-center gap-1 transition shadow-sm';
        } else {
          btn.className = 'feedback-type-btn p-2 rounded-xl text-xs font-medium border border-slate-700 bg-slate-900 text-slate-400 hover:border-emerald-500/50 hover:text-slate-200 flex flex-col items-center gap-1 transition';
        }
      });
    }

    function setFeedbackRating(stars) {
      currentFeedbackRating = stars ? parseInt(stars, 10) : null;
      const ratingInput = document.getElementById('selectedFeedbackRating');
      if (ratingInput) ratingInput.value = currentFeedbackRating || '';

      const starButtons = document.querySelectorAll('#feedbackStarRatingContainer .star-btn');
      starButtons.forEach((btn) => {
        const starVal = parseInt(btn.getAttribute('data-star'), 10);
        if (currentFeedbackRating && starVal <= currentFeedbackRating) {
          btn.className = 'star-btn text-amber-400 hover:text-amber-300 transition';
        } else {
          btn.className = 'star-btn text-slate-700 hover:text-slate-500 transition';
        }
      });

      const label = document.getElementById('feedbackRatingLabel');
      if (label) {
        const labels = {
          1: '😞 Poor',
          2: '😐 Fair',
          3: '🙂 Good',
          4: '😃 Great',
          5: '🌟 Outstanding!'
        };
        label.textContent = currentFeedbackRating ? labels[currentFeedbackRating] || '' : '';
      }
    }

    function updateFeedbackCharCount(el) {
      const counter = document.getElementById('feedbackCharCount');
      if (counter && el) {
        counter.textContent = `${el.value.length} / 2000`;
      }
    }

    async function submitUserFeedback() {
      const msgInput = document.getElementById('feedbackMessageInput');
      const message = msgInput ? msgInput.value.trim() : '';

      if (!message || message.length < 3) {
        showToast('Please enter a feedback message (at least 3 characters).', 'error');
        if (msgInput) msgInput.focus();
        return;
      }

      const type = document.getElementById('selectedFeedbackType') ? document.getElementById('selectedFeedbackType').value : 'general';
      const rating = currentFeedbackRating;
      const isAnon = document.getElementById('feedbackAnonymousCheckbox') && document.getElementById('feedbackAnonymousCheckbox').checked;
      const page = window.location.hash || window.location.pathname || 'dashboard';

      const btn = document.getElementById('btnSubmitFeedback');
      const origHtml = btn ? btn.innerHTML : '';
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span class="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></span><span>Sending...</span>`;
      }

      try {
        const headers = { 'Content-Type': 'application/json' };
        if (!isAnon) {
          const token = localStorage.getItem(AUTH_TOKEN_KEY);
          if (token) headers['Authorization'] = `Bearer ${token}`;
        }

        const res = await fetch('/api/feedback', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            type,
            rating,
            message,
            page
          })
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to submit feedback.');
        }

        closeModal('feedbackModal');
        showToast('🎉 Thank you! Your feedback has been received and saved.', 'success');

        // If Super Admin is viewing admin panel, live update feedback list
        if (typeof activeAdminSubTab !== 'undefined' && activeAdminSubTab === 'feedback') {
          fetchAdminFeedback();
        }
      } catch (err) {
        showToast(err.message || 'Error submitting feedback. Please try again.', 'error');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = origHtml;
        }
      }
    }

    // =========================================================================
    // SUPER ADMIN FEEDBACK MANAGEMENT LOGIC
    // =========================================================================
    let activeAdminSubTab = 'users';
    let adminFeedbackCache = [];
    let adminGroupsCache = [];

    function switchAdminSubTab(subTab) {
      activeAdminSubTab = subTab;
      const btnUsers = document.getElementById('btnAdminTabUsers');
      const btnGroups = document.getElementById('btnAdminTabGroups');
      const btnFeedback = document.getElementById('btnAdminTabFeedback');
      const usersSection = document.getElementById('adminUsersSubSection');
      const groupsSection = document.getElementById('adminGroupsSubSection');
      const feedbackSection = document.getElementById('adminFeedbackSubSection');

      const activeCls = 'px-3.5 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20 transition flex items-center gap-2';
      const inactiveCls = 'px-3.5 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold text-slate-300 hover:bg-slate-800/80 transition flex items-center gap-2';

      if (btnUsers) btnUsers.className = subTab === 'users' ? activeCls : inactiveCls;
      if (btnGroups) btnGroups.className = subTab === 'groups' ? activeCls : inactiveCls;
      if (btnFeedback) btnFeedback.className = subTab === 'feedback' ? activeCls : inactiveCls;

      if (usersSection) usersSection.classList.toggle('hidden', subTab !== 'users');
      if (groupsSection) groupsSection.classList.toggle('hidden', subTab !== 'groups');
      if (feedbackSection) feedbackSection.classList.toggle('hidden', subTab !== 'feedback');

      if (subTab === 'groups') {
        fetchAdminGroups();
      } else if (subTab === 'feedback') {
        fetchAdminFeedback();
      }
    }

    async function fetchAdminGroups(silent = false) {
      const container = document.getElementById('adminGroupsListContainer');
      if (container && !silent) {
        container.innerHTML = `
          <div class="text-center py-10 text-slate-500 text-xs flex items-center justify-center gap-2">
            <span class="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin"></span>
            <span>Fetching all platform groups from MongoDB Atlas...</span>
          </div>`;
      }

      try {
        const res = await apiFetch('/api/admin/groups');
        adminGroupsCache = (res && res.groups) || [];

        const totalGroupsEl = document.getElementById('adminTotalGroupsStat');
        const subTabGroupsCount = document.getElementById('adminSubTabGroupsCount');
        if (totalGroupsEl) totalGroupsEl.textContent = adminGroupsCache.length;
        if (subTabGroupsCount) subTabGroupsCount.textContent = adminGroupsCache.length;

        const q = document.getElementById('adminGroupSearchInput') ? document.getElementById('adminGroupSearchInput').value : '';
        filterAdminGroups(q);
      } catch (err) {
        if (container && !silent) {
          container.innerHTML = `
            <div class="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs text-center">
              Failed to load platform groups: ${escapeHtml(err.message || 'Access restricted')}
            </div>`;
        }
      }
    }

    function filterAdminGroups(query) {
      const q = String(query || '').trim().toLowerCase();
      let filtered = adminGroupsCache;
      if (q) {
        filtered = filtered.filter((g) =>
          (g.name && g.name.toLowerCase().includes(q)) ||
          (g.inviteCode && g.inviteCode.toLowerCase().includes(q)) ||
          (g.adminEmail && g.adminEmail.toLowerCase().includes(q)) ||
          (Array.isArray(g.members) && g.members.some((m) =>
            (m.name && m.name.toLowerCase().includes(q)) ||
            (m.email && m.email.toLowerCase().includes(q))
          ))
        );
      }
      renderAdminGroups(filtered);
    }

    function renderAdminGroups(items) {
      const container = document.getElementById('adminGroupsListContainer');
      if (!container) return;

      if (!items || items.length === 0) {
        container.innerHTML = `
          <div class="text-center py-12 p-6 rounded-2xl bg-slate-900/60 border border-slate-800 text-slate-500 text-xs space-y-1">
            <span class="text-2xl block mb-2">🏘️</span>
            <p class="font-medium text-slate-400">No platform groups found matching your search.</p>
          </div>`;
        return;
      }

      container.innerHTML = items.map((g) => {
        const gid = g.id || g._id;
        const createdStr = g.createdAt ? new Date(g.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'Recent';
        const membersHtml = (g.members || []).map((m) => {
          const isAdm = m.role === 'admin' || m.role === 'owner' || (g.adminEmail && m.email && g.adminEmail.toLowerCase() === m.email.toLowerCase());
          const isPend = m.status === 'pending_acceptance';
          return `
            <div class="px-2.5 py-1.5 rounded-xl bg-slate-950/90 border ${isAdm ? 'border-amber-500/40' : 'border-slate-800'} flex items-center justify-between gap-2 text-xs">
              <div class="min-w-0 truncate">
                <span class="font-semibold text-white">${escapeHtml(m.name || 'Member')}</span>
                <span class="text-[11px] text-slate-400 font-mono ml-1">(${escapeHtml(m.email || '')})</span>
              </div>
              <div class="flex items-center gap-1 flex-shrink-0">
                ${isAdm ? '<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">👑 Admin</span>' : ''}
                ${isPend ? '<span class="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-500/15 text-amber-200 border border-amber-500/25">⏳ Pending</span>' : '<span class="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/25">Active</span>'}
              </div>
            </div>
          `;
        }).join('');

        return `
          <div class="p-4 sm:p-5 rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-slate-700 transition space-y-3 overflow-hidden" data-testid="admin-group-card-${escapeHtml(gid)}">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
              <div class="min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <h4 class="text-sm sm:text-base font-extrabold text-white truncate">${escapeHtml(g.name)}</h4>
                  <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-teal-500/15 text-teal-300 border border-teal-500/30">${escapeHtml(g.category || 'Trip')}</span>
                  <span class="px-2 py-0.5 rounded text-[10px] font-mono-code bg-slate-800 text-emerald-300 border border-slate-700">${escapeHtml(g.inviteCode || '')}</span>
                  ${g.isArchived ? '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300">Archived</span>' : ''}
                </div>
                <div class="text-[11px] text-slate-400 mt-1 flex items-center gap-2 flex-wrap">
                  <span>Admin: <strong class="text-amber-300">${escapeHtml(g.adminEmail || g.createdByEmail || 'Unknown')}</strong></span>
                  <span>·</span>
                  <span>Created: ${createdStr}</span>
                  <span>·</span>
                  <span>${g.billCount || 0} bills (${formatINR(g.totalSpend || 0)})</span>
                </div>
              </div>
              <div class="flex items-center gap-2 flex-shrink-0 self-end sm:self-auto">
                <button
                  type="button"
                  data-testid="btn-admin-delete-group-${escapeHtml(gid)}"
                  onclick="deleteAdminGroup('${escapeHtml(gid)}', '${escapeHtml(g.name)}')"
                  class="px-3 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-xs font-bold transition flex items-center gap-1.5"
                >
                  <span>🗑️</span>
                  <span>Delete Group</span>
                </button>
              </div>
            </div>

            <div class="space-y-1.5">
              <div class="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Group Members (${(g.members || []).length})
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-1.5 max-h-48 overflow-y-auto custom-scroll pr-1">
                ${membersHtml || '<div class="text-xs text-slate-500">No members in this group.</div>'}
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    async function deleteAdminGroup(groupId, groupName) {
      if (!groupId) return;
      try {
        const res = await apiFetch(`/api/admin/groups/${groupId}`, {
          method: 'DELETE'
        });
        showToast(`🗑️ ${res.message || `Deleted group "${groupName}".`}`);
        adminGroupsCache = adminGroupsCache.filter((g) => (g.id || g._id) !== groupId);
        appState.groups = (appState.groups || []).filter((g) => g.id !== groupId);
        appState.expenses = (appState.expenses || []).filter((e) => e.groupId !== groupId);
        appState.settlements = (appState.settlements || []).filter((s) => s.groupId !== groupId);

        const totalGroupsEl = document.getElementById('adminTotalGroupsStat');
        const subTabGroupsCount = document.getElementById('adminSubTabGroupsCount');
        if (totalGroupsEl) totalGroupsEl.textContent = adminGroupsCache.length;
        if (subTabGroupsCount) subTabGroupsCount.textContent = adminGroupsCache.length;

        saveState();
        refreshAllViews();
        const q = document.getElementById('adminGroupSearchInput') ? document.getElementById('adminGroupSearchInput').value : '';
        filterAdminGroups(q);
      } catch (err) {
        showToast(err.message || 'Failed to delete group.', 'error');
      }
    }

    async function fetchAdminFeedback(silent = false) {
      const container = document.getElementById('adminFeedbackListContainer');
      if (container && !silent) {
        container.innerHTML = `
          <div class="text-center py-10 text-slate-500 text-xs flex items-center justify-center gap-2">
            <span class="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin"></span>
            <span>Fetching user feedback from MongoDB Atlas...</span>
          </div>`;
      }

      try {
        const res = await apiFetch('/api/admin/feedback');
        adminFeedbackCache = res.feedbacks || [];

        // Update counts
        const total = adminFeedbackCache.length;
        const newCount = adminFeedbackCache.filter((f) => f.status === 'new').length;

        const totalEl = document.getElementById('adminTotalFeedbackStat');
        const badgeEl = document.getElementById('adminNewFeedbackBadge');
        const subTabCountEl = document.getElementById('adminSubTabFeedbackCount');

        if (totalEl) totalEl.textContent = total;
        if (badgeEl) badgeEl.textContent = `${newCount} new`;
        if (subTabCountEl) subTabCountEl.textContent = newCount > 0 ? `${newCount} new` : total;

        const searchVal = document.getElementById('adminFeedbackSearchInput') ? document.getElementById('adminFeedbackSearchInput').value : '';
        filterAdminFeedback(searchVal);
      } catch (err) {
        if (container && !silent) {
          container.innerHTML = `
            <div class="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs text-center">
              Failed to load feedback: ${escapeHtml(err.message || 'Access restricted')}
            </div>`;
        }
      }
    }

    function filterAdminFeedback(query) {
      const q = String(query || '').trim().toLowerCase();
      const typeSelect = document.getElementById('adminFeedbackTypeFilter');
      const statusSelect = document.getElementById('adminFeedbackStatusFilter');

      const typeFilter = typeSelect ? typeSelect.value : 'ALL';
      const statusFilter = statusSelect ? statusSelect.value : 'ALL';

      let filtered = adminFeedbackCache;
      if (typeFilter !== 'ALL') {
        filtered = filtered.filter((f) => f.type === typeFilter);
      }
      if (statusFilter !== 'ALL') {
        filtered = filtered.filter((f) => f.status === statusFilter);
      }

      if (q) {
        filtered = filtered.filter((f) =>
          (f.message && f.message.toLowerCase().includes(q)) ||
          (f.userName && f.userName.toLowerCase().includes(q)) ||
          (f.userEmail && f.userEmail.toLowerCase().includes(q)) ||
          (f.adminNotes && f.adminNotes.toLowerCase().includes(q))
        );
      }

      renderAdminFeedback(filtered);
    }

    function renderAdminFeedback(items) {
      const container = document.getElementById('adminFeedbackListContainer');
      if (!container) return;

      if (!items || items.length === 0) {
        container.innerHTML = `
          <div class="text-center py-12 p-6 rounded-2xl bg-slate-900/60 border border-slate-800 text-slate-500 text-xs space-y-1">
            <span class="text-2xl block mb-2">📬</span>
            <p class="font-medium text-slate-400">No feedback entries found matching current filters.</p>
            <p class="text-[11px] text-slate-600">When users submit feedback or comments, they will appear here in real-time.</p>
          </div>`;
        return;
      }

      const typeIcons = {
        feature: '💡 Feature',
        bug: '🐛 Bug',
        ux: '✨ Design/UX',
        general: '💬 General'
      };

      const typeBadgeStyles = {
        feature: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
        bug: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
        ux: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
        general: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
      };

      const statusBadgeStyles = {
        new: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
        reviewed: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
        in_progress: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
        resolved: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
      };

      const html = items.map((f) => {
        const typeLabel = typeIcons[f.type] || '💬 General';
        const typeStyle = typeBadgeStyles[f.type] || typeBadgeStyles.general;
        const statusStyle = statusBadgeStyles[f.status] || statusBadgeStyles.new;
        const statusText = f.status.replace('_', ' ').toUpperCase();

        const createdDate = new Date(f.createdAt);
        const dateStr = createdDate.toLocaleString([], {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });

        const userInitial = (f.userName || f.userEmail || 'G').slice(0, 1).toUpperCase();
        const userDisplay = f.userEmail
          ? `<span class="font-bold text-white">${escapeHtml(f.userName || 'User')}</span> <span class="text-slate-400 font-mono text-[11px]">(${escapeHtml(f.userEmail)})</span>`
          : `<span class="font-bold text-slate-300">Anonymous Guest</span>`;

        let starsHtml = '';
        if (f.rating) {
          starsHtml = `<span class="text-amber-400 text-xs tracking-tight" title="${f.rating} Stars">${'★'.repeat(f.rating)}${'☆'.repeat(5 - f.rating)}</span>`;
        }

        const pageBadge = f.page
          ? `<span class="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">Page: ${escapeHtml(f.page)}</span>`
          : '';

        return `
          <div class="p-3.5 sm:p-5 rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-slate-700 transition space-y-3 overflow-hidden max-w-full" id="feedbackCard_${f._id}">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
              <div class="flex items-start sm:items-center gap-2.5 min-w-0">
                <div class="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-bold text-slate-300 flex-shrink-0">
                  ${userInitial}
                </div>
                <div class="min-w-0 flex-1">
                  <div class="text-xs break-words">${userDisplay}</div>
                  <div class="text-[10px] text-slate-500">${dateStr}</div>
                </div>
              </div>
              <div class="flex items-center gap-1.5 flex-wrap">
                ${starsHtml}
                <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${typeStyle}">
                  ${typeLabel}
                </span>
                <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-extrabold border ${statusStyle}">
                  ${statusText}
                </span>
                ${pageBadge}
              </div>
            </div>

            <!-- Message Body -->
            <div class="text-xs sm:text-sm text-slate-200 leading-relaxed whitespace-pre-wrap break-words bg-slate-950/60 p-3 sm:p-3.5 rounded-xl border border-slate-800/80">
              ${escapeHtml(f.message)}
            </div>

            <!-- Admin Action Controls: Mobile-First Responsive Grid/Flex (Zero Horizontal Overflow) -->
            <div class="flex flex-col gap-2 pt-1 w-full">
              <div class="flex items-center justify-between gap-2 w-full">
                <div class="flex items-center gap-2 min-w-0 flex-1 sm:flex-initial">
                  <span class="text-[11px] text-slate-400 whitespace-nowrap flex-shrink-0">Status:</span>
                  <select
                    onchange="updateAdminFeedbackStatus('${f._id}', this.value)"
                    class="flex-1 sm:flex-initial min-w-0 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                  >
                    <option value="new" ${f.status === 'new' ? 'selected' : ''}>🟡 New</option>
                    <option value="reviewed" ${f.status === 'reviewed' ? 'selected' : ''}>🔵 Reviewed</option>
                    <option value="in_progress" ${f.status === 'in_progress' ? 'selected' : ''}>🟣 In Progress</option>
                    <option value="resolved" ${f.status === 'resolved' ? 'selected' : ''}>🟢 Resolved</option>
                  </select>
                </div>

                <button
                  type="button"
                  onclick="deleteAdminFeedback('${f._id}')"
                  class="px-2.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-semibold transition flex items-center justify-center gap-1 flex-shrink-0 whitespace-nowrap"
                  title="Delete this feedback entry"
                >
                  <span>🗑️</span>
                  <span>Delete</span>
                </button>
              </div>

              <div class="flex items-center gap-2 w-full">
                <input
                  type="text"
                  id="adminNotes_${f._id}"
                  value="${escapeHtml(f.adminNotes || '')}"
                  placeholder="Internal developer notes..."
                  class="flex-1 min-w-0 px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500"
                />
                <button
                  type="button"
                  onclick="saveAdminFeedbackNotes('${f._id}')"
                  class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition flex-shrink-0 whitespace-nowrap"
                  title="Save Notes"
                >
                  💾 Save Note
                </button>
              </div>
            </div>
          </div>`;
      }).join('');

      container.innerHTML = html;
    }

    async function updateAdminFeedbackStatus(id, newStatus) {
      try {
        const res = await apiFetch(`/api/admin/feedback/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: newStatus })
        });
        showToast('✓ Feedback status updated.');
        const item = adminFeedbackCache.find((f) => f._id === id);
        if (item) item.status = newStatus;

        // Update counts
        const newCount = adminFeedbackCache.filter((f) => f.status === 'new').length;
        const badgeEl = document.getElementById('adminNewFeedbackBadge');
        const subTabCountEl = document.getElementById('adminSubTabFeedbackCount');
        if (badgeEl) badgeEl.textContent = `${newCount} new`;
        if (subTabCountEl) subTabCountEl.textContent = newCount > 0 ? `${newCount} new` : adminFeedbackCache.length;

        const searchVal = document.getElementById('adminFeedbackSearchInput') ? document.getElementById('adminFeedbackSearchInput').value : '';
        filterAdminFeedback(searchVal);
      } catch (err) {
        showToast(err.message || 'Failed to update feedback status.', 'error');
      }
    }

    async function saveAdminFeedbackNotes(id) {
      const input = document.getElementById(`adminNotes_${id}`);
      const notes = input ? input.value : '';

      try {
        await apiFetch(`/api/admin/feedback/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ adminNotes: notes })
        });
        showToast('✓ Developer note saved.');
        const item = adminFeedbackCache.find((f) => f._id === id);
        if (item) item.adminNotes = notes;
      } catch (err) {
        showToast(err.message || 'Failed to save note.', 'error');
      }
    }

    async function deleteAdminFeedback(id) {
      // Direct feedback deletion with toast notification

      try {
        await apiFetch(`/api/admin/feedback/${id}`, {
          method: 'DELETE'
        });
        showToast('🗑️ Feedback entry deleted.');
        adminFeedbackCache = adminFeedbackCache.filter((f) => f._id !== id);

        const total = adminFeedbackCache.length;
        const newCount = adminFeedbackCache.filter((f) => f.status === 'new').length;
        const totalEl = document.getElementById('adminTotalFeedbackStat');
        const badgeEl = document.getElementById('adminNewFeedbackBadge');
        const subTabCountEl = document.getElementById('adminSubTabFeedbackCount');

        if (totalEl) totalEl.textContent = total;
        if (badgeEl) badgeEl.textContent = `${newCount} new`;
        if (subTabCountEl) subTabCountEl.textContent = newCount > 0 ? `${newCount} new` : total;

        const searchVal = document.getElementById('adminFeedbackSearchInput') ? document.getElementById('adminFeedbackSearchInput').value : '';
        filterAdminFeedback(searchVal);
      } catch (err) {
        showToast(err.message || 'Failed to delete feedback.', 'error');
      }
    }

    function promptLogout() {
      const user = appState.currentUser;
      const avatarEl = document.getElementById('logoutModalAvatar');
      const nameEl = document.getElementById('logoutModalName');
      const emailEl = document.getElementById('logoutModalEmail');
      const balBadge = document.getElementById('logoutModalBalanceBadge');

      if (user) {
        if (nameEl) nameEl.textContent = user.name || 'User';
        if (emailEl) emailEl.textContent = user.email || '';
        if (avatarEl) {
          const initials = (user.name || user.email || 'U')
            .split(' ')
            .map((w) => w[0])
            .join('')
            .slice(0, 2)
            .toUpperCase();
          avatarEl.textContent = initials;
        }
        if (balBadge) {
          try {
            const { myNet } = computeBalancesAndSimplifications('ALL');
            if (myNet > 0.01) {
              balBadge.className = 'text-xs font-bold text-emerald-400';
              balBadge.textContent = `+${formatINR(myNet)} (Owed)`;
            } else if (myNet < -0.01) {
              balBadge.className = 'text-xs font-bold text-rose-400';
              balBadge.textContent = `-${formatINR(Math.abs(myNet))} (Owes)`;
            } else {
              balBadge.className = 'text-xs font-bold text-slate-300';
              balBadge.textContent = 'Settled (₹0.00)';
            }
          } catch (e) {
            balBadge.textContent = '₹0.00';
          }
        }
      }
      openModal('logoutConfirmModal');
    }

    function executeLogout() {
      closeModal('logoutConfirmModal');
      handleLogout();
    }

    function handleLogout() {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem('vasool_active_tab');
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', window.location.pathname);
      } else {
        window.location.hash = '';
      }
      activeMainTab = 'dashboard';
      const panelAdmin = document.getElementById('panelAdmin');
      if (panelAdmin) panelAdmin.classList.add('hidden');
      appState = createDefaultState();
      showingAuthPortal = true;
      renderTopLevelView();
      switchMainTab('dashboard');
      refreshAllViews();
      showToast('Signed out. Please log in or sign up to continue.');
    }

    window.promptLogout = promptLogout;
    window.executeLogout = executeLogout;
    window.handleLogout = handleLogout;
