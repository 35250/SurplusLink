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

        if (!hasRole(user, "RECIPIENT")) {
            return {
                statusCode: 403,
                headers: corsHeaders,
                body: JSON.stringify({
                    message: "Only recipients can view available surplus"
                })
            };
        }
        
        // Get all surplus records from DynamoDB
        const result = await db.send(
            new ScanCommand({
                TableName: "SurplusLink"
            })
        );

        const now = new Date();

        // Keep only surplus that is still available
        const availableSurplus = (result.Items || []).filter((surplus) => {

            const expiresAt = new Date(surplus.expiresAt);

            return (
                surplus.remainingQuantity > 0 &&
                expiresAt > now
            );
        });

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                surplus: availableSurplus
            })
        };

    } catch (error) {

        console.error("Get surplus error:", error);

        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                message: "Failed to fetch available surplus"
            })
        };
    }
};