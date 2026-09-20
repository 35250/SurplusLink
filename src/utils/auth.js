function getAuthenticatedUser(event) {
    const claims = event?.requestContext?.authorizer?.claims;

    if (!claims?.sub) {
        return null;
    }

    const groups = claims["cognito:groups"]
        ? claims["cognito:groups"].split(",")
        : [];

    return {
        userId: claims.sub,
        groups,
        email: claims.email,
        providerName: claims["custom:providerName"]
    };
}

function hasRole(user, role) {
    return user?.groups.includes(role);
}

module.exports = {
    getAuthenticatedUser,
    hasRole
};