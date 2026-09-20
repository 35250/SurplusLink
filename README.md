# SurplusLink

> A serverless surplus food distribution system that connects businesses and organizations with recipients who can collect excess food before it goes to waste.

## Live Demo

**Live URL:** [SurplusLink](https://main.dq9gygdl6mi1f.amplifyapp.com)
**Demo Video:** [Demo](https://www.youtube.com/watch?v=Xj7XS89Cxb4&feature=youtu.be)

**Region:** AWS `ap-south-1`

---

## Problem

Restaurants, hotels, cafeterias, event organizers, and other food providers can have usable food left over at the end of the day or after an event.

At the same time, NGOs, community kitchens, shelters, and other recipient organizations may need access to food that can still be safely collected and distributed.

The problem is not always the absence of surplus food or recipients. The problem is having a simple system that connects the two sides quickly while keeping track of:

* What surplus is available
* How much is still available
* Where and when it can be collected
* Who reserved it
* Whether the surplus has already expired

SurplusLink addresses this workflow with a serverless architecture built on AWS.

---

## Solution

SurplusLink has two user roles:

### Provider

A provider can:

* Create a surplus food listing
* Specify food type and quantity
* Provide pickup information
* Set an expiration time
* View their own active surplus listings
* Receive an email notification when a recipient makes a reservation

### Recipient

A recipient can:

* View currently available surplus
* See the provider name and pickup information
* Reserve a requested quantity
* View their own reservations

The core workflow is:

```text
Provider posts surplus
        ↓
Recipient discovers surplus
        ↓
Recipient reserves quantity
        ↓
Reservation + quantity update happen atomically
        ↓
Provider receives SNS notification
        ↓
Surplus expires
        ↓
EventBridge Scheduler removes expired record
```

---

## Architecture

```text
                         ┌──────────────────┐
                         │     Cognito      │
                         │ Authentication   │
                         │   + User Roles   │
                         └────────┬─────────┘
                                  │
                                  │ ID Token
                                  ▼
┌────────────────┐        ┌──────────────────┐
│    Browser     │ ─────► │   API Gateway    │
│  Amplify Host  │  HTTPS │ Cognito Authorizer│
└────────────────┘        └────────┬─────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │     Lambda       │
                         │ Business Logic   │
                         └───────┬────┬─────┘
                                 │    │
                  ┌──────────────┘    └──────────────┐
                  ▼                                  ▼
          ┌────────────────┐                 ┌──────────────┐
          │   DynamoDB     │                 │     SNS      │
          │ SurplusLink    │                 │ Notification │
          │ Reservations   │                 └──────┬───────┘
          └────────────────┘                        │
                                                   ▼
                                             Provider Email

                         ┌───────────────────────┐
                         │ EventBridge Scheduler  │
                         │      every 5 minutes   │
                         └───────────┬───────────┘
                                     │
                                     ▼
                              ExpireSurplus
                                 Lambda
                                     │
                                     ▼
                                DynamoDB
                              delete expired
```

---

## AWS Services Used

### Amazon Cognito

Used for:

* User signup and login
* Email verification
* User identity
* Role information
* Provider name storage

Two Cognito groups are used:

```text
PROVIDER
RECIPIENT
```

Provider accounts also store:

```text
custom:providerName
```

The provider name is entered once during signup rather than being requested every time a surplus is created.

After authentication, the ID token contains the user's identity and relevant claims.

---

### Amazon API Gateway

API Gateway is the HTTPS entry point for the backend.

It uses a Cognito User Pool authorizer to validate the user's token before invoking protected Lambda functions.

Routes:

| Method | Route                          | Purpose                         |
| ------ | ------------------------------ | ------------------------------- |
| `POST` | `/surplus`                     | Create surplus                  |
| `GET`  | `/surplus`                     | Get available surplus           |
| `POST` | `/surplus/{surplusId}/reserve` | Reserve surplus                 |
| `GET`  | `/my-reservations`             | Get current user's reservations |
| `GET`  | `/my-surplus`                  | Get current provider's surplus  |

---

### AWS Lambda

Lambda contains the application business logic.

Handlers:

```text
src/handlers/
├── assignUserRole.js
├── createSurplus.js
├── getSurplus.js
├── reserveSurplus.js
├── getMyReservations.js
├── getMySurplus.js
└── expireSurplus.js
```

Lambda functions are invoked through API Gateway, Cognito lifecycle events, and EventBridge Scheduler.

---

### Amazon DynamoDB

Two tables are used.

#### `SurplusLink`

Stores active surplus records:

```text
surplusId
providerId
providerName
foodType
quantity
remainingQuantity
pickupAddress
contactNumber
expiresAt
createdAt
```

#### `Reservations`

Stores reservations:

```text
reservationId
surplusId
recipientId
quantity
createdAt
status
providerName
foodType
pickupAddress
contactNumber
expiresAt
```

Reservation records store a snapshot of the relevant surplus/provider information so that reservation history can be displayed without a database join.

---

### Amazon SNS

SNS is used to notify providers when their surplus is reserved.

The flow is:

```text
Recipient reserves surplus
        ↓
reserveSurplus Lambda
        ↓
DynamoDB transaction succeeds
        ↓
SNS Publish
        ↓
Provider's subscribed email
```

The SNS message contains a `providerId` message attribute.

Provider email subscriptions use a matching filter so that the notification is delivered to the provider whose surplus was reserved rather than to every provider.

Providers receive an SNS subscription confirmation email after onboarding and must confirm the subscription before receiving reservation notifications.

---

### Amazon EventBridge Scheduler

A recurring Scheduler runs every five minutes.

```text
EventBridge Scheduler
        ↓
ExpireSurplusFunction
        ↓
Scan active surplus records
        ↓
expiresAt <= current time
        ↓
Delete expired records
```

Expired records are removed from `SurplusLink` rather than maintaining a separate status field.

Expiration is therefore handled as cleanup, while reservation safety is enforced independently by the reservation transaction.

---

## Authentication and Authorization

SurplusLink separates **authentication** from **authorization**.

### Authentication

Cognito authenticates the user.

API Gateway validates the Cognito token before invoking protected Lambda functions.

### Role Authorization

Lambda reads the authenticated user's Cognito group and checks whether the requested operation is allowed.

Examples:

```text
POST /surplus
→ PROVIDER required

GET /surplus
→ RECIPIENT required

POST /surplus/{surplusId}/reserve
→ RECIPIENT required

GET /my-surplus
→ PROVIDER required

GET /my-reservations
→ RECIPIENT required
```

### User Identity

The application does not trust a `providerId` or `recipientId` supplied by the browser.

Instead:

```text
Cognito ID Token
      ↓
API Gateway
      ↓
event.requestContext.authorizer.claims
      ↓
claims.sub
```

The Cognito `sub` becomes the application's user identity.

This prevents a client from simply submitting another user's ID to access that user's records.

---

## Reservation Concurrency

Reservation quantity is updated using a DynamoDB transaction with a conditional expression.

The critical condition is:

```text
remainingQuantity >= requestedQuantity
AND
expiresAt > currentTime
```

The transaction performs two operations atomically:

```text
1. Reduce remainingQuantity
2. Create reservation
```

Therefore, if multiple recipients try to reserve the same remaining quantity concurrently, DynamoDB evaluates the condition at the time of the write instead of trusting an earlier read.

This prevents the system from allocating more food than is actually available.

---

## Expiration Design

Surplus records contain an `expiresAt` timestamp.

Expiration is intentionally handled at two different levels:

### Reservation protection

`reserveSurplus.js` checks:

```text
expiresAt > now
```

inside the DynamoDB transaction.

Therefore, an expired surplus cannot be successfully reserved even if the scheduled cleanup has not happened yet.

### Automatic cleanup

EventBridge Scheduler invokes `expireSurplus.js` every five minutes.

Expired surplus records are deleted from `SurplusLink`.

This keeps the active-surplus table focused on currently relevant records.

---

## Food Types

The frontend and backend currently support:

```text
VEG
NON_VEG
BAKERY_DESSERTS
BEVERAGES
PACKAGED_FOOD
OTHER
```

The backend validates the submitted value against this allowed set.

---

## API Request Model

### Create surplus

`POST /surplus`

Example request:

```json
{
  "foodType": "VEG",
  "quantity": 10,
  "pickupAddress": "Test Restaurant, Kolkata",
  "contactNumber": "9876543210",
  "expiresAt": "2026-09-20T15:00:00.000Z"
}
```

The client does **not** submit:

```text
providerId
providerName
role
```

Those are derived from the authenticated Cognito identity.

---

### Reserve surplus

`POST /surplus/{surplusId}/reserve`

Example:

```json
{
  "quantity": 2
}
```

The `surplusId` is taken from the URL path.

The recipient identity is taken from the authenticated Cognito token.

This gives the request a clear separation:

```text
JWT
→ Who?

URL
→ Which surplus?

Request body
→ How much?
```

---

## Project Structure

```text
SurplusLink/
│
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── app.js
│
├── src/
│   ├── handlers/
│   │   ├── assignUserRole.js
│   │   ├── createSurplus.js
│   │   ├── getSurplus.js
│   │   ├── reserveSurplus.js
│   │   ├── getMyReservations.js
│   │   ├── getMySurplus.js
│   │   └── expireSurplus.js
│   │
│   └── utils/
│       ├── auth.js
│       └── cors.js
│
├── template.yaml
├── package.json
├── package-lock.json
├── .gitignore
└── README.md
```

---

## Infrastructure as Code

The AWS infrastructure is defined through AWS SAM in:

```text
template.yaml
```

The template provisions and connects:

* DynamoDB tables
* Cognito User Pool
* Cognito Groups
* Cognito App Client
* Lambda functions
* API Gateway
* SNS topic
* EventBridge Scheduler
* Required IAM permissions
* API Gateway CORS configuration

Deployment is performed through:

```bash
sam build
sam deploy
```

This keeps the AWS architecture reproducible rather than relying on manual console configuration.

---

## Frontend

The frontend is intentionally lightweight and built using:

```text
HTML
CSS
JavaScript
```

It is hosted on **AWS Amplify Hosting** as a static web application.

The frontend communicates directly with:

* Amazon Cognito for authentication
* API Gateway for backend requests

No frontend server is required after deployment.

---

## Local Development

### Backend

From the project root:

```bash
sam build
sam deploy
```

### Frontend

From the `frontend` directory:

```bash
npx --yes http-server . -p 5500
```

Then open:

```text
http://localhost:5500
```

---

## Testing Performed

The system was tested through the complete workflow, including:

* Provider signup
* Recipient signup
* Email confirmation
* Provider login
* Recipient login
* Provider surplus creation
* Available surplus retrieval
* Reservation creation
* Remaining quantity update
* Reservation history retrieval
* Provider surplus retrieval
* Invalid input validation
* Role-based authorization
* Cognito identity propagation
* SNS provider notification
* EventBridge-based expiration cleanup
* CORS-enabled browser requests

The SNS notification workflow was also verified using a real provider email subscription, including the required SNS email confirmation step.

---

## Engineering Decisions

Several design decisions were intentionally kept simple for the MVP while preserving the important backend guarantees.

### User identity comes from Cognito

The browser never decides which user owns a record.

```text
Cognito sub
    ↓
providerId / recipientId
```

### Reservation uses a transaction

Reducing inventory and creating a reservation happen atomically.

### Expired records are deleted

The active surplus table is not used as a long-term historical archive.

### Provider name is an account attribute

The provider enters the name once during signup. It is then obtained from Cognito rather than being repeatedly entered for every surplus listing.

### No unnecessary AWS services

The architecture intentionally avoids adding infrastructure that is not required for the MVP.

---

## AI-Assisted Development

ChatGPT was used as a development assistant during the project for:

* Architecture discussions and design review
* AWS service selection and integration guidance
* DynamoDB data-model and concurrency discussions
* Cognito authentication and authorization guidance
* AWS SAM and API Gateway configuration
* Lambda code review and debugging
* SNS and EventBridge Scheduler integration
* Frontend structure and user-flow design
* HTML/CSS/JavaScript implementation assistance
* API integration and browser CORS troubleshooting
* Documentation assistance

---

## Project Status

SurplusLink is a functional serverless MVP with:

```text
✅ Authentication
✅ Role-based authorization
✅ Provider surplus creation
✅ Recipient discovery
✅ Safe quantity reservation
✅ Reservation history
✅ Provider history
✅ Email notifications
✅ Automatic expiration cleanup
✅ Browser-based frontend
✅ Public deployment
```

Built for the **Bharat Build Tour – First Stop** hackathon.

---

## Contact

**LinkedIn:** https://www.linkedin.com/in/ayandey212105242

