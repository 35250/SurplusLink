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
                    message: "Only recipients can view reservations"
                })
            };
        }

        const recipientId = user.userId;

        // Get all reservation records
        const result = await db.send(
            new ScanCommand({
                TableName: "Reservations"
            })
        );

        // Keep only reservations belonging to this recipient
        const myReservations = (result.Items || []).filter(
            (reservation) => reservation.recipientId === recipientId
        );

        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({
                reservations: myReservations
            })
        };

    } catch (error) {

        console.error("Get my reservations error:", error);

        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                message: "Failed to fetch reservations"
            })
        };
    }
};