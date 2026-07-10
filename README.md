# Expo Lead Generator

A static lead-capture website for exhibitors and expo organisers.

## What it does

- Creates Exhibitor and Expo Organiser accounts.
- Generates QR codes for campaigns.
- Allows each QR campaign to save a scan-preview banner for the event or booth.
- Exhibitor QR flow collects customer name, phone, email, requested sales person, and notes before opening the exhibitor link.
- Organiser QR flow collects customer name, phone, email, requested sales person, and notes, then displays a badge number.
- Organiser dashboard verifies badge numbers and exports captured leads as CSV.
- Admin accounts can view all exhibitor and expo organiser records and download CSV data per event.
- The Account tab shows event QR codes created by the signed-in user; admin accounts see all event QR codes.
- Saves accounts, QR campaigns, and leads locally first, with Google Sheets sync through the built-in Apps Script web app.
- Includes a local QRCode generator script, so QR generation works without relying on a CDN.
- Creates Stripe Checkout subscription sessions for $7.99/month with remaining trial days calculated from the account `createdAt` date stored in Google Sheets.

Campaign banners are resized in the browser and stored in the `CampaignBanners` sheet as chunked rows keyed by campaign ID, keeping each chunk below Google Sheets' 50,000-character cell limit.

## Admin Accounts

To make an account an admin, set that account's `role` value to `admin` in the `Accounts` sheet. On the next login, that user will see the Admin tab and can view or download all event records. The admin export endpoint checks the logged-in account against the sheet before returning all records.

Admins can also manage account and event records from the Admin tab:

- User accounts: update name, email, role, subscription status, and temporary password.
- Events: update owner, account type, QR name, event or booth label, exhibitor destination link, and scan-preview banner.

The temporary password field writes to `adminTemporaryPassword`, so the user can log in with that exact temporary password and then change it.

## Admin Password Resets

The app does not permanently store exact user passwords in the sheet. For admin resets, use the `adminTemporaryPassword` column on the `Accounts` sheet:

1. Type a temporary password in `adminTemporaryPassword` for the user.
2. The user logs in with that temporary password or uses it as the current password in Change Password.
3. The script saves the new password hash and clears `adminTemporaryPassword`.

## Connect the Google Sheet

The Google Sheet edit link is not a write API by itself. To save into the sheet:

1. Open the linked Google Sheet.
2. Go to **Extensions > Apps Script**.
3. Paste the contents of `google-apps-script.gs`.
4. Deploy as **Web app**.
5. Set access to the users who should be allowed to submit data.
6. Copy the web app URL ending in `/exec`.
The website uses this web app URL by default:

`https://script.google.com/macros/s/AKfycbznl7KQLWVlJjrtoeBzY3ILIRc2xvz4VE0v6Uhbp3FeapRmw5YDtjBoBpUl_NEaqSLv/exec`

The target sheet ID is already set to:

`1yUfreitpLB9QSbUnygiqAfQhk4HYUCF0HWf_tEO-Vw4`

## Stripe Setup

Do not paste the Stripe secret key into the website files. In Apps Script:

1. Open **Project Settings**.
2. Add a Script Property named `STRIPE_SECRET_KEY`.
3. Set its value to the Stripe live secret key.
4. Enable **Show "appsscript.json" manifest file in editor**.
5. Copy `appsscript.json` from this project into the Apps Script manifest.
6. Run `authorizeExpoLeadGeneratorServices` once from the Apps Script editor and approve permissions.
7. Redeploy the web app.

The browser calls Apps Script to create Stripe Checkout sessions. Subscription checkout attempts are logged in the `Subscriptions` sheet.

To switch payments to a different Stripe account, replace the `STRIPE_SECRET_KEY` Script Property with the new Stripe live secret key, then redeploy the Apps Script web app. The Stripe publishable key is not used by this static checkout flow because Checkout sessions are created server-side by Apps Script.

## Run

Open `index.html` in a browser. The app is static and does not require a build step.

For production, host the files on a normal HTTPS static host so QR links work for customer phones.
