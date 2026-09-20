const crypto = require("crypto");
const { corsHeaders } = require("../utils/cors");
const { getAuthenticatedUser, hasRole } = require("../utils/auth");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
    DynamoDBDocumentClient,
    GetCommand,
    TransactWriteCommand
} = require("@aws-sdk/lib-dynamodb");

const {
    SNSClient,
    PublishCommand
} = require("@aws-sdk/client-sns");

const client = new DynamoDBClient({
    region: "ap-south-1"
});

const snsClient = new SNSClient({
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
                    message: "Only recipients can reserve surplus food"
                })
            };
        }

        // Check that a request body exists
        if (!event.body) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    message: "Reservation informations is required"
                })
            };
        }

        // Convert JSON string into JavaScript object
        let data;

        try {
            data = JSON.parse(event.body);
        } catch (error) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    message: "Invalid informations"
                })
            };
        }

        const surplusId = event.pathParameters?.surplusId;

        if (
            typeof surplusId !== "string" ||
            surplusId.trim().length === 0
        ) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    message: "surplusId is required"
                })
            };
        }

        // Validate requested quantity
        if (
            typeof data.quantity !== "number" ||
            !Number.isInteger(data.quantity) ||
            data.quantity <= 0 ||
            data.quantity > 10000
        ) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    message: "Quantity must be a positive integer between 1 and 10000"
                })
            };
        }

        const recipientId = user.userId;

        // Get the surplus first
        const surplusResult = await db.send(
            new GetCommand({
                TableName: "SurplusLink",
                Key: {
                    surplusId
                }
            })
        );

        const surplus = surplusResult.Item;

        // Check whether surplus exists
        if (!surplus) {
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({
                    message: "Surplus not found"
                })
            };
        }

        // Check whether surplus has expired
        const now = new Date();
        const expiresAt = new Date(surplus.expiresAt);

        if (expiresAt <= now) {
            return {
                statusCode: 409,
                headers: corsHeaders,
                body: JSON.stringify({
                    message: "This surplus has expired"
                })
            };
        }

        // Create reservation ID
        const reservationId = crypto.randomUUID();

        const reservation = {
            reservationId,
            surplusId,
            recipientId,
            quantity: data.quantity,
            createdAt: now.toISOString(),
            status: "RESERVED",

            // Store details needed to display the reservation later
            providerName: surplus.providerName,
            foodType: surplus.foodType,
            pickupAddress: surplus.pickupAddress,
            contactNumber: surplus.contactNumber,
            expiresAt: surplus.expiresAt
        };

        // Atomically:
        // 1. Reduce remaining quantity
        // 2. Create reservation
        await db.send(
            new TransactWriteCommand({
                TransactItems: [

                    {
                        Update: {
                            TableName: "SurplusLink",

                            Key: {
                                surplusId
                            },

                            UpdateExpression:
                                "SET remainingQuantity = remainingQuantity - :quantity",

                            ConditionExpression:
                                "remainingQuantity >= :quantity AND expiresAt > :now",

                            ExpressionAttributeValues: {
                                ":quantity": data.quantity,
                                ":now": now.toISOString()
                            }
                        }
                    },

                    {
                        Put: {
                            TableName: "Reservations",
                            Item: reservation
                        }
                    }

                ]
            })
        );

        try {
            await snsClient.send(
                new PublishCommand({
                    TopicArn: process.env.NOTIFICATION_TOPIC_ARN,

                    Message:
                        `Reservation received! A recipient has reserved ${data.quantity} units of your ${surplus.foodType} surplus. Please prepare the reserved quantity for pickup.`,

                    MessageAttributes: {
                        providerId: {
                            DataType: "String",
                            StringValue: surplus.providerId
                        }
                    }
                })
            );

            console.log("Provider notification sent successfully");

        } catch (notificationError) {
            console.error(
                "Reservation created, but provider notification failed:",
                notificationError
            );
        }

        return {
            statusCode: 201,
            headers: corsHeaders,
            body: JSON.stringify({
                message: "Reservation created successfully",
                reservation
            })
        };

    } catch (error) {

        console.error("Reserve surplus error:", error);

        // Conditional update failed
        if (error.name === "TransactionCanceledException") {
            return {
                statusCode: 409,
                headers: corsHeaders,
                body: JSON.stringify({
                    message: "Reservation failed. The surplus may have expired or may not have enough quantity."
                })
            };
        }

        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                message: "Failed to create reservation"
            })
        };
    }
};