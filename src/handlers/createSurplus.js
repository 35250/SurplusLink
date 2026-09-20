const crypto = require("crypto");
const { corsHeaders } = require("../utils/cors");
const { getAuthenticatedUser, hasRole } = require("../utils/auth");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
    DynamoDBDocumentClient,
    PutCommand
} = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({
    region: "ap-south-1"
});

const db = DynamoDBDocumentClient.from(client);

const allowedFoodTypes = [
    "VEG",
    "NON_VEG",
    "BAKERY_DESSERTS",
    "BEVERAGES",
    "PACKAGED_FOOD",
    "OTHER"
];

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
                    message: "Only providers can create surplus food"
                })
            };
        }
        
        // Check that a request body exists
        if (!event.body) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    message: "Surplus information is required"
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

        // Validate food type
        if (!allowedFoodTypes.includes(data.foodType)) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    message: "Invalid food type"
                })
            };
        }

        // Validate quantity
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

        // Validate pickup address
        if (
            typeof data.pickupAddress !== "string" ||
            data.pickupAddress.trim().length < 5 ||
            data.pickupAddress.trim().length > 300
        ) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    message: "Invalid pickup address"
                })
            };
        }

        // Validate Indian phone number
        if (
            typeof data.contactNumber !== "string" ||
            !/^[6-9]\d{9}$/.test(data.contactNumber)
        ) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    message: "Invalid Indian phone number"
                })
            };
        }

        // Validate expiration time
        const expiresAt = new Date(data.expiresAt);

        if (
            typeof data.expiresAt !== "string" ||
            Number.isNaN(expiresAt.getTime()) ||
            expiresAt <= new Date()
        ) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    message: "expiresAt must be a valid future date"
                })
            };
        }

        const providerId = user.userId;
        const providerName = user.providerName;

        if (!providerName) {
            return {
                statusCode: 400,
                headers: corsHeaders,
                body: JSON.stringify({
                    message: "Provider profile is incomplete"
                })
            };
        }

        // Create surplus record
        const surplus = {
            surplusId: crypto.randomUUID(),

            providerId,
            providerName,

            foodType: data.foodType,
            quantity: data.quantity,
            remainingQuantity: data.quantity,

            pickupAddress: data.pickupAddress.trim(),
            contactNumber: data.contactNumber,

            expiresAt: expiresAt.toISOString(),
            createdAt: new Date().toISOString()
        };

        // Store surplus in DynamoDB
        await db.send(
            new PutCommand({
                TableName: "SurplusLink",
                Item: surplus
            })
        );

        return {
            statusCode: 201,
            headers: corsHeaders,
            body: JSON.stringify({
                message: "Surplus created successfully",
                surplus
            })
        };

    } catch (error) {

        console.error("Create surplus error:", error);

        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({
                message: "Failed to create surplus"
            })
        };
    }
};