(() => {
  const authView = document.getElementById("authView");
  const dashboardView = document.getElementById("dashboardView");
  const authMessage = document.getElementById("authMessage");
  const panels = ["loginPanel", "signupPanel", "recoveryPanel", "recoveryCodePanel"]
    .map(id => document.getElementById(id));

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

  document.querySelectorAll("[data-password-toggle]").forEach(button => {
    button.addEventListener("click", () => {
      const input = document.getElementById(button.dataset.passwordToggle);
      const revealing = input.type === "password";
      input.type = revealing ? "text" : "password";
      button.textContent = revealing ? "Hide" : "Show";
      button.setAttribute("aria-label", `${revealing ? "Hide" : "Show"} password`);
    });
  });

  document.getElementById("usernameLoginForm").addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget;
    submitForm(form, "Signing in…", async () => {
      const result = await request("/api/auth/login", {
        username: document.getElementById("loginUsername").value.trim(),
        password: document.getElementById("usernameLoginPassword").value
      });
      form.reset();
      showDashboard(result.profile);
    });
  });

  document.getElementById("showSignupBtn").addEventListener("click", () => showPanel("signupPanel"));
  document.getElementById("showLoginBtn").addEventListener("click", () => showPanel("loginPanel"));
  document.getElementById("backToLoginBtn").addEventListener("click", () => showPanel("loginPanel"));

  const usernameInput = document.getElementById("signupUsername");

  document.getElementById("signupForm").addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget;
    const username = usernameInput.value.trim().toLowerCase();
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
      const result = await request("/api/auth/signup", {
        username,
        password,
        confirmPassword: confirmation
      });
      form.reset();
      if (result.recoveryCode) {
        document.getElementById("recoveryCodeValue").textContent = result.recoveryCode;
        showPanel("recoveryCodePanel");
        window.RememberMePendingProfile = result.profile;
      }
    });
  });

  document.getElementById("continueAfterSignupBtn").addEventListener("click", event => {
    const profile = window.RememberMePendingProfile;
    delete window.RememberMePendingProfile;
    if (profile) {
      showDashboard(profile);
    } else {
      showAuth("loginPanel", "Your recovery code is saved on screen only once. Log in with your new username.");
    }
  });

  document.getElementById("forgotUsernameBtn").addEventListener("click", () => {
    showPanel("recoveryPanel");
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
