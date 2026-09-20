const COGNITO_ENDPOINT =
    "https://cognito-idp.ap-south-1.amazonaws.com/";

const CLIENT_ID = "6rgcistn85j31ochk63lsqhpec";

const API_BASE =
    "https://yeaoe5fz3e.execute-api.ap-south-1.amazonaws.com/Prod";

let idToken = null;
let currentRole = null;
let confirmationUsername = null;

// --------------------------------------------------
// Helper: call Cognito
// --------------------------------------------------

async function callCognito(action, body) {
    const response = await fetch(COGNITO_ENDPOINT, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-amz-json-1.1",
            "X-Amz-Target": `AWSCognitoIdentityProviderService.${action}`
        },
        body: JSON.stringify(body)
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.message || "Cognito request failed");
    }

    return data;
}

// --------------------------------------------------
// Helper: call API Gateway
// --------------------------------------------------

async function callApi(path, options = {}) {
    if (!idToken) {
        throw new Error("Please log in first.");
    }

    const headers = {
        Authorization: `Bearer ${idToken}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
    };

    const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.message || "API request failed");
    }

    return data;
}

// --------------------------------------------------
// Sign Up
// --------------------------------------------------

document.getElementById("signup-form").addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = document.getElementById("signup-email").value.trim();
    const password = document.getElementById("signup-password").value;
    const role = document.getElementById("signup-role").value;
    const providerName = document.getElementById("provider-name").value.trim();

    if (!role) {
        showAuthMessage("Please select a role.");
        return;
    }

    if (role === "PROVIDER" && !providerName) {
        showAuthMessage("Provider name is required.");
        return;
    }

    const userAttributes = [
        {
            Name: "email",
            Value: email
        },
        {
            Name: "custom:role",
            Value: role
        }
    ];

    if (role === "PROVIDER") {
        userAttributes.push({
            Name: "custom:providerName",
            Value: providerName
        });
    }

    try {
        showAuthMessage("Creating account...");

        await callCognito("SignUp", {
            ClientId: CLIENT_ID,
            Username: email,
            Password: password,
            UserAttributes: userAttributes
        });

        confirmationUsername = email;

        document.getElementById("signup-form").classList.add("hidden");
        document.getElementById("login-form").classList.add("hidden");
        document.getElementById("confirm-form").classList.remove("hidden");

        showAuthMessage(
            "Account created. Check your email for the confirmation code."
        );

    } catch (error) {
        console.error("Signup error:", error);
        showAuthMessage(error.message);
    }
});

// --------------------------------------------------
// Confirm Sign Up
// --------------------------------------------------

document.getElementById("confirm-form").addEventListener("submit", async (event) => {
    event.preventDefault();

    const code = document.getElementById("confirmation-code").value.trim();

    try {
        showAuthMessage("Confirming account...");

        await callCognito("ConfirmSignUp", {
            ClientId: CLIENT_ID,
            Username: confirmationUsername,
            ConfirmationCode: code
        });

        document.getElementById("confirm-form").classList.add("hidden");
        document.getElementById("login-form").classList.remove("hidden");

        document.getElementById("login-email").value = confirmationUsername;

        showAuthMessage(
            "Email confirmed successfully. You can now log in."
        );

    } catch (error) {
        console.error("Confirmation error:", error);
        showAuthMessage(error.message);
    }
});

// --------------------------------------------------
// Login
// --------------------------------------------------

document.getElementById("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;

    try {
        showAuthMessage("Logging in...");

        const data = await callCognito("InitiateAuth", {
            ClientId: CLIENT_ID,
            AuthFlow: "USER_PASSWORD_AUTH",
            AuthParameters: {
                USERNAME: email,
                PASSWORD: password
            }
        });

        idToken = data.AuthenticationResult.IdToken;

        const claims = decodeJwtPayload(idToken);

        currentRole = claims["custom:role"];

        if (
            currentRole !== "PROVIDER" &&
            currentRole !== "RECIPIENT"
        ) {
            throw new Error("Invalid user role.");
        }

        showAuthMessage("");

        document.getElementById("auth-section").classList.add("hidden");

        if (currentRole === "PROVIDER") {
            document
                .getElementById("provider-dashboard")
                .classList.remove("hidden");
                loadMySurplus();

        } else {
            document
                .getElementById("recipient-dashboard")
                .classList.remove("hidden");
                loadAvailableSurplus();
                loadMyReservations();
        }

    } catch (error) {
        console.error("Login error:", error);
        showAuthMessage(error.message);
    }
});

// --------------------------------------------------
// Decode JWT payload
// --------------------------------------------------

function decodeJwtPayload(token) {
    const payload = token.split(".")[1];

    const normalized = payload
        .replace(/-/g, "+")
        .replace(/_/g, "/");

    const decoded = atob(normalized);

    return JSON.parse(decoded);
}

// --------------------------------------------------
// UI helpers
// --------------------------------------------------

function showLogin() {
    document.getElementById("login-form").classList.remove("hidden");
    document.getElementById("signup-form").classList.add("hidden");
    document.getElementById("confirm-form").classList.add("hidden");
    showAuthMessage("");
}

function showSignup() {
    document.getElementById("signup-form").classList.remove("hidden");
    document.getElementById("login-form").classList.add("hidden");
    document.getElementById("confirm-form").classList.add("hidden");
    showAuthMessage("");
}

function toggleProviderName() {
    const role = document.getElementById("signup-role").value;
    const providerNameInput = document.getElementById("provider-name");

    if (role === "PROVIDER") {
        providerNameInput.classList.remove("hidden");
        providerNameInput.required = true;
    } else {
        providerNameInput.classList.add("hidden");
        providerNameInput.required = false;
        providerNameInput.value = "";
    }
}

window.togglePassword = function (inputId, button) {
    const input = document.getElementById(inputId);

    if (input.type === "password") {
        input.type = "text";
        button.textContent = "Hide";
    } else {
        input.type = "password";
        button.textContent = "Show";
    }
};

function showAuthMessage(message) {
    document.getElementById("auth-message").textContent = message;
}

// --------------------------------------------------
// Logout
// --------------------------------------------------

function logout() {
    idToken = null;
    currentRole = null;

    document
        .getElementById("provider-dashboard")
        .classList.add("hidden");

    document
        .getElementById("recipient-dashboard")
        .classList.add("hidden");

    document
        .getElementById("auth-section")
        .classList.remove("hidden");

    showLogin();
}

// --------------------------------------------------
// Create Surplus
// --------------------------------------------------

document.getElementById("create-surplus-form").addEventListener("submit", async (event) => {
    event.preventDefault();

    const foodType = document.getElementById("food-type").value;
    const quantity = Number(document.getElementById("quantity").value);
    const pickupAddress = document.getElementById("pickup-address").value.trim();
    const contactNumber = document.getElementById("contact-number").value.trim();
    const expiresAtInput = document.getElementById("expires-at").value;

    try {
        const expiresAt = new Date(expiresAtInput);

        const data = await callApi("/surplus", {
            method: "POST",
            body: JSON.stringify({
                foodType,
                quantity,
                pickupAddress,
                contactNumber,
                expiresAt: expiresAt.toISOString()
            })
        });

        alert(data.message);

        document.getElementById("create-surplus-form").reset();

        await loadMySurplus();

    } catch (error) {
        console.error("Create surplus error:", error);
        alert(error.message);
    }
});

// --------------------------------------------------
// Load Provider's Surplus
// --------------------------------------------------

window.loadMySurplus = async function () {
    const container = document.getElementById("my-surplus-list");

    container.textContent = "Loading...";

    try {
        const data = await callApi("/my-surplus", {
            method: "GET"
        });

        if (!data.surplus || data.surplus.length === 0) {
            container.textContent = "No surplus available.";
            return;
        }

        container.innerHTML = data.surplus.map((surplus) => `
            <div class="item">
                <strong>${escapeHtml(surplus.foodType)}</strong>
                <p>Quantity: ${surplus.quantity}</p>
                <p>Remaining: ${surplus.remainingQuantity}</p>
                <p>Pickup: ${escapeHtml(surplus.pickupAddress)}</p>
                <p>Contact: ${escapeHtml(surplus.contactNumber)}</p>
                <p>Expires: ${formatDate(surplus.expiresAt)}</p>
            </div>
        `).join("");

    } catch (error) {
        console.error("Get my surplus error:", error);
        container.textContent = error.message;
    }
};

// --------------------------------------------------
// Load Available Surplus
// --------------------------------------------------

window.loadAvailableSurplus = async function () {
    const container = document.getElementById("available-surplus-list");

    container.textContent = "Loading...";

    try {
        const data = await callApi("/surplus", {
            method: "GET"
        });

        if (!data.surplus || data.surplus.length === 0) {
            container.textContent = "No surplus currently available.";
            return;
        }

        container.innerHTML = data.surplus.map((surplus) => `
            <div class="item">
                <h4>${escapeHtml(surplus.providerName)}</h4>

                <p>Food: ${escapeHtml(surplus.foodType)}</p>
                <p>Remaining: ${surplus.remainingQuantity}</p>
                <p>Pickup: ${escapeHtml(surplus.pickupAddress)}</p>
                <p>Contact: ${escapeHtml(surplus.contactNumber)}</p>
                <p>Expires: ${formatDate(surplus.expiresAt)}</p>

                <input
                    type="number"
                    id="quantity-${surplus.surplusId}"
                    min="1"
                    max="${surplus.remainingQuantity}"
                    value="1"
                >

                <button
                    type="button"
                    onclick="reserveSurplus('${surplus.surplusId}')"
                >
                    Reserve
                </button>
            </div>
        `).join("");

    } catch (error) {
        console.error("Get available surplus error:", error);
        container.textContent = error.message;
    }
};

// --------------------------------------------------
// Reserve Surplus
// --------------------------------------------------

window.reserveSurplus = async function (surplusId) {
    const quantityInput = document.getElementById(
        `quantity-${surplusId}`
    );

    const quantity = Number(quantityInput.value);

    if (!Number.isInteger(quantity) || quantity <= 0) {
        alert("Please enter a valid quantity.");
        return;
    }

    try {
        const data = await callApi(
            `/surplus/${encodeURIComponent(surplusId)}/reserve`,
            {
                method: "POST",
                body: JSON.stringify({
                    quantity
                })
            }
        );

        alert(data.message);

        await loadAvailableSurplus();
        await loadMyReservations();

    } catch (error) {
        console.error("Reserve surplus error:", error);
        alert(error.message);
    }
};

// --------------------------------------------------
// Load My Reservations
// --------------------------------------------------

window.loadMyReservations = async function () {
    const container = document.getElementById("my-reservations-list");

    container.textContent = "Loading...";

    try {
        const data = await callApi("/my-reservations", {
            method: "GET"
        });

        if (!data.reservations || data.reservations.length === 0) {
            container.textContent = "No reservations yet.";
            return;
        }

        container.innerHTML = data.reservations.map((reservation) => `
            <div class="item">
                <h4>${escapeHtml(reservation.providerName)}</h4>

                <p>Food: ${escapeHtml(reservation.foodType)}</p>
                <p>Reserved quantity: ${reservation.quantity}</p>
                <p>Status: ${escapeHtml(reservation.status)}</p>
                <p>Pickup: ${escapeHtml(reservation.pickupAddress)}</p>
                <p>Contact: ${escapeHtml(reservation.contactNumber)}</p>
                <p>Expires: ${formatDate(reservation.expiresAt)}</p>
            </div>
        `).join("");

    } catch (error) {
        console.error("Get my reservations error:", error);
        container.textContent = error.message;
    }
};

// --------------------------------------------------
// Display helpers
// --------------------------------------------------

function formatDate(value) {
    return new Date(value).toLocaleString();
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}