(() => {
  const authView = document.getElementById("authView");
  const dashboardView = document.getElementById("dashboardView");
  const authMessage = document.getElementById("authMessage");
  const panels = ["loginPanel", "signupPanel", "recoveryPanel", "resetPanel", "recoveryCodePanel"]
    .map(id => document.getElementById(id));
  let usernameCheckTimer;

  async function request(path, body) {
    const response = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: body === undefined ? { Accept: "application/json" } : { "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Something went wrong. Please try again.");
    return result;
  }

  function message(text, type = "") {
    authMessage.textContent = text;
    authMessage.className = `auth-message${type ? ` is-${type}` : ""}`;
    authMessage.hidden = !text;
  }

  function showPanel(id) {
    panels.forEach(panel => { panel.hidden = panel.id !== id; });
    message("");
  }

  function showAuth(id = "loginPanel", notice = "") {
    dashboardView.hidden = true;
    authView.hidden = false;
    showPanel(id);
    if (notice) message(notice, "success");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showDashboard(profile) {
    authView.hidden = true;
    dashboardView.hidden = false;
    const label = profile.username ? `@${profile.username}` : (profile.displayName || "Your account");
    document.getElementById("profileLabel").textContent = label;
    window.RememberMeDashboard?.load(profile);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setBusy(form, busy, label) {
    const button = form.querySelector('button[type="submit"]');
    if (!button) return;
    if (busy) {
      button.dataset.label = button.textContent;
      button.textContent = label;
      button.disabled = true;
    } else {
      button.textContent = button.dataset.label || button.textContent;
      button.disabled = false;
    }
  }

  async function submitForm(form, label, action) {
    message("");
    setBusy(form, true, label);
    try {
      await action();
    } catch (error) {
      message(error.message, "error");
    } finally {
      setBusy(form, false);
    }
  }

  document.getElementById("emailTab").addEventListener("click", event => {
    document.getElementById("emailLoginForm").hidden = false;
    document.getElementById("usernameLoginForm").hidden = true;
    event.currentTarget.classList.add("is-active");
    event.currentTarget.setAttribute("aria-selected", "true");
    document.getElementById("usernameTab").classList.remove("is-active");
    document.getElementById("usernameTab").setAttribute("aria-selected", "false");
    message("");
  });

  document.getElementById("usernameTab").addEventListener("click", event => {
    document.getElementById("emailLoginForm").hidden = true;
    document.getElementById("usernameLoginForm").hidden = false;
    event.currentTarget.classList.add("is-active");
    event.currentTarget.setAttribute("aria-selected", "true");
    document.getElementById("emailTab").classList.remove("is-active");
    document.getElementById("emailTab").setAttribute("aria-selected", "false");
    message("");
  });

  document.querySelectorAll("[data-password-toggle]").forEach(button => {
    button.addEventListener("click", () => {
      const input = document.getElementById(button.dataset.passwordToggle);
      const revealing = input.type === "password";
      input.type = revealing ? "text" : "password";
      button.textContent = revealing ? "Hide" : "Show";
      button.setAttribute("aria-label", `${revealing ? "Hide" : "Show"} password`);
    });
  });

  document.getElementById("emailLoginForm").addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget;
    submitForm(form, "Signing in…", async () => {
      const result = await request("/api/auth/login", {
        mode: "email",
        email: document.getElementById("loginEmail").value.trim(),
        password: document.getElementById("emailLoginPassword").value
      });
      form.reset();
      showDashboard(result.profile);
    });
  });

  document.getElementById("usernameLoginForm").addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget;
    submitForm(form, "Signing in…", async () => {
      const result = await request("/api/auth/login", {
        mode: "username",
        username: document.getElementById("loginUsername").value.trim(),
        password: document.getElementById("usernameLoginPassword").value
      });
      form.reset();
      showDashboard(result.profile);
    });
  });

  document.getElementById("googleLoginBtn").addEventListener("click", async event => {
    const button = event.currentTarget;
    button.disabled = true;
    message("");
    try {
      const result = await request("/api/auth/google", {});
      window.location.assign(result.url);
    } catch (error) {
      message(error.message, "error");
      button.disabled = false;
    }
  });

  document.getElementById("showSignupBtn").addEventListener("click", () => showPanel("signupPanel"));
  document.getElementById("showLoginBtn").addEventListener("click", () => showPanel("loginPanel"));
  document.getElementById("backToLoginBtn").addEventListener("click", () => showPanel("loginPanel"));

  const usernameInput = document.getElementById("signupUsername");
  const availability = document.getElementById("usernameAvailability");
  usernameInput.addEventListener("input", () => {
    clearTimeout(usernameCheckTimer);
    const username = usernameInput.value.trim().toLowerCase();
    availability.textContent = "";
    availability.className = "field-hint availability";
    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      if (username.length) {
        availability.textContent = "Use 3–24 lowercase letters, numbers, or underscores.";
        availability.classList.add("is-invalid");
      }
      return;
    }
    availability.textContent = "Checking availability…";
    usernameCheckTimer = setTimeout(async () => {
      try {
        const result = await request(`/api/auth/username?username=${encodeURIComponent(username)}`);
        if (usernameInput.value.trim().toLowerCase() !== username) return;
        availability.textContent = result.available ? "Lovely, that username is available!" : "That username is already taken.";
        availability.classList.add(result.available ? "is-available" : "is-taken");
      } catch {
        if (usernameInput.value.trim().toLowerCase() === username) {
          availability.textContent = "We couldn’t check right now. You can still try signing up.";
        }
      }
    }, 450);
  });

  document.getElementById("signupForm").addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget;
    const username = usernameInput.value.trim().toLowerCase();
    const email = document.getElementById("signupEmail").value.trim();
    const password = document.getElementById("signupPassword").value;
    const confirmation = document.getElementById("signupConfirmPassword").value;
    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      message("Choose a username with 3–24 lowercase letters, numbers, or underscores.", "error");
      return;
    }
    if (password.length < 10 || password.length > 128) {
      message("Your password must be between 10 and 128 characters.", "error");
      return;
    }
    if (password !== confirmation) {
      message("Those passwords don’t match yet. Please check and try again.", "error");
      return;
    }
    submitForm(form, "Creating your account…", async () => {
      const result = await request("/api/auth/signup", { username, email: email || null, password });
      form.reset();
      availability.textContent = "";
      if (result.recoveryCode) {
        document.getElementById("recoveryCodeValue").textContent = result.recoveryCode;
        showPanel("recoveryCodePanel");
        document.getElementById("continueAfterSignupBtn").dataset.pendingConfirmation = String(Boolean(result.requiresEmailConfirmation));
        if (result.profile) window.RememberMePendingProfile = result.profile;
      } else {
        showPanel("loginPanel");
        message(result.message || "If an account can be created, we’ll send the next steps to your email.", "success");
      }
    });
  });

  document.getElementById("continueAfterSignupBtn").addEventListener("click", event => {
    const requiresConfirmation = event.currentTarget.dataset.pendingConfirmation === "true";
    const profile = window.RememberMePendingProfile;
    delete window.RememberMePendingProfile;
    if (requiresConfirmation) {
      showAuth("loginPanel", "Check your email to confirm your account, then log in. Keep your recovery code somewhere safe.");
    } else if (profile) {
      showDashboard(profile);
    } else {
      showAuth("loginPanel", "Your recovery code is saved on screen only once. Log in with your new username.");
    }
  });

  document.getElementById("forgotEmailBtn").addEventListener("click", () => {
    document.getElementById("emailRecoveryForm").hidden = false;
    document.getElementById("usernameRecoveryForm").hidden = true;
    showPanel("recoveryPanel");
  });

  document.getElementById("forgotUsernameBtn").addEventListener("click", () => {
    document.getElementById("emailRecoveryForm").hidden = true;
    document.getElementById("usernameRecoveryForm").hidden = false;
    showPanel("recoveryPanel");
  });

  document.getElementById("emailRecoveryForm").addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget;
    submitForm(form, "Sending…", async () => {
      const result = await request("/api/auth/recovery-email", { email: document.getElementById("recoveryEmail").value.trim() });
      message(result.message, "success");
      form.reset();
    });
  });

  document.getElementById("usernameRecoveryForm").addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget;
    const password = document.getElementById("recoveryNewPassword").value;
    if (password.length < 10) {
      message("Your new password must be at least 10 characters.", "error");
      return;
    }
    submitForm(form, "Resetting…", async () => {
      await request("/api/auth/recovery-username", {
        username: document.getElementById("recoveryUsername").value.trim().toLowerCase(),
        recoveryCode: document.getElementById("recoveryCode").value.trim(),
        password
      });
      form.reset();
      showAuth("loginPanel", "Password updated. Log in with your new password.");
    });
  });

  document.getElementById("resetPasswordForm").addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget;
    const password = document.getElementById("resetNewPassword").value;
    if (password.length < 10 || password !== document.getElementById("resetConfirmPassword").value) {
      message(password.length < 10 ? "Use at least 10 characters." : "Those passwords don’t match yet.", "error");
      return;
    }
    submitForm(form, "Saving…", async () => {
      await request("/api/auth/reset-password", { password });
      await request("/api/auth/logout", {});
      form.reset();
      showAuth("loginPanel", "Your password was changed. Please log in again.");
      history.replaceState(null, "", location.pathname);
    });
  });

  document.getElementById("logoutBtn").addEventListener("click", async event => {
    event.currentTarget.disabled = true;
    try {
      await request("/api/auth/logout", {});
      window.RememberMeDashboard?.clear();
      showAuth("loginPanel", "You’re safely logged out. See you soon!");
    } catch (error) {
      message(error.message, "error");
      event.currentTarget.disabled = false;
    }
  });

  window.addEventListener("rememberme:session-expired", () => {
    window.RememberMeDashboard?.clear();
    showAuth("loginPanel", "Your session expired. Please log in again.");
  });

  async function initializeAuth() {
    const query = new URLSearchParams(location.search);
    if (query.get("reset") === "1") {
      showAuth("resetPanel");
      return;
    }
    if (query.get("auth") === "confirmed") {
      message("Your email is confirmed. Log in to see your special days.", "success");
    } else if (query.get("auth") === "confirmation") {
      message("Almost there! Check your email and confirm your account before logging in.", "success");
    } else if (query.get("authError")) {
      message("We couldn’t finish sign-in. Please try again.", "error");
    }
    try {
      const result = await request("/api/auth/session");
      if (result.profile) showDashboard(result.profile);
    } catch (error) {
      if (/not signed in/i.test(error.message)) return;
      if (/not configured/i.test(error.message)) {
        message("Account services aren’t configured yet. Add the Supabase and rate-limit secrets to Vercel to enable sign-in.", "error");
      }
    }
  }

  initializeAuth();
})();
