const {
    CognitoIdentityProviderClient,
    AdminAddUserToGroupCommand
} = require("@aws-sdk/client-cognito-identity-provider");

const {
    SNSClient,
    SubscribeCommand
} = require("@aws-sdk/client-sns");

const cognitoClient = new CognitoIdentityProviderClient({
    region: "ap-south-1"
});

const snsClient = new SNSClient({
    region: "ap-south-1"
});

exports.handler = async (event) => {
    try {
        const role = event.request.userAttributes["custom:role"];
        const email = event.request.userAttributes["email"];
        const username = event.userName;
        const userPoolId = event.userPoolId;

        if (role !== "PROVIDER" && role !== "RECIPIENT") {
            throw new Error("Invalid user role");
        }

        // Assign the user to the correct Cognito group
        await cognitoClient.send(
            new AdminAddUserToGroupCommand({
                UserPoolId: userPoolId,
                Username: username,
                GroupName: role
            })
        );

        // Only providers need reservation notifications
        if (role === "PROVIDER") {
            const providerId = username;

            await snsClient.send(
                new SubscribeCommand({
                    TopicArn: process.env.NOTIFICATION_TOPIC_ARN,
                    Protocol: "email",
                    Endpoint: email,
                    Attributes: {
                        FilterPolicy: JSON.stringify({
                            providerId: [providerId]
                        })
                    }
                })
            );

            console.log(`Provider ${providerId} subscribed to SNS notifications`);
        }

        console.log(`User ${username} assigned to ${role} group`);

        return event;

    } catch (error) {
        console.error("User role assignment failed:", error);
        throw error;
    }
};