const { getAuthenticatedUser, hasRole } = require("../utils/auth");
const { corsHeaders } = require("../utils/cors");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
    DynamoDBDocumentClient,
    ScanCommand
} = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({
    region: "ap-south-1"
});

const db = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
    try {
        const user = getAuthenticatedUser(event);

        if (!user) {
            return {
                statusCode: 401,
                headers: corsHeaders,
                body: JSON.stringify({
                    message: "Authentication required"
                })
            };
        }

        if (!hasRole(user, "PROVIDER")) {
            return {
                statusCode: 403,
                headers: corsHeaders,
                body: JSON.stringify({
                    message: "Only providers can view their surplus"
                })
            };
        }

        const providerId = user.userId;

        // Get all surplus records
        const result = await db.send(
            new ScanCommand({
                TableName: "SurplusLink"
            })
        );

        // Keep only surplus posted by this provider
        const mySurplus = (result.Items || []).filter(
            (surplus) => surplus.providerId === providerId
        );

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                surplus: mySurplus
            })
        };

    } catch (error) {

        console.error("Get my surplus error:", error);

        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                message: "Failed to fetch your surplus"
            })
        };
    }
};