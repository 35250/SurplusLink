const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");

const {
    DynamoDBDocumentClient,
    ScanCommand,
    DeleteCommand
} = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({
    region: "ap-south-1"
});

const db = DynamoDBDocumentClient.from(client);

exports.handler = async () => {
    try {
        const result = await db.send(
            new ScanCommand({
                TableName: "SurplusLink"
            })
        );

        const now = new Date();

        const expiredSurplus = (result.Items || []).filter((surplus) => {
            const expiresAt = new Date(surplus.expiresAt);

            return expiresAt <= now;
        });

        for (const surplus of expiredSurplus) {
            await db.send(
                new DeleteCommand({
                    TableName: "SurplusLink",
                    Key: {
                        surplusId: surplus.surplusId
                    }
                })
            );
        }

        console.log(`Deleted ${expiredSurplus.length} expired surplus records`);

    } catch (error) {
        console.error("Expire surplus error:", error);
        throw error;
    }
};