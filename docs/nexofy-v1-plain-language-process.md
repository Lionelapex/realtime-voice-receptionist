# Nexofy Voice Agent 1.0 — How the whole process works

Plain-language walkthrough for Sunday.  
No technical jargon. This is the story of one phone call from start to finish.

---

## The big idea in one sentence

A customer phones the business.  
An AI receptionist answers, helps them, books them in, and emails the business — even if nobody at the shop is free to pick up.

---

## The main parts (in everyday words)

Think of it like a small team working together:

| Part | Everyday meaning |
|---|---|
| **Phone number** | The number customers dial (provided through Twilio) |
| **Call handler** | The system that answers and talks (Retell + the voice AI) |
| **Business brain** | Your server that knows this company’s services, prices, and bookings (Express) |
| **Company filing cabinet** | The database where company info and bookings are stored (PostgreSQL) |
| **Diary** | The calendar that shows which times are free (Cal.com) |
| **Messenger** | The helper that sends emails/SMS after the call (n8n) |

Important split:

- The **call handler talks**.  
- The **business brain remembers and books**.  
- The **filing cabinet stores the facts**.

---

# Part A — Before any customer calls (setup once per business)

This happens when Nexofy onboards a new client.

### Step A1 — Collect the business details
Nexofy gathers:

- business name  
- opening hours  
- services and prices  
- common questions and approved answers  
- who to transfer to if someone wants a human  
- where booking emails should go  

**What is happening:**  
We are teaching the receptionist about *this* business only.

---

### Step A2 — Save those details in the filing cabinet
All of that information is stored under that company’s record.

**What is happening:**  
The system now has a private folder for that business.  
Salon A’s prices never mix with Clinic B’s prices.

---

### Step A3 — Give the business its phone number
A phone number is assigned and linked to that business’s receptionist.

**What is happening:**  
When someone dials that number, the system already knows which company they are calling.

---

### Step A4 — Set up the talking receptionist
The call handler is configured with:

- the greeting  
- the tone of voice  
- the rules (“don’t invent answers”)  
- the ability to ask the business brain for prices/bookings  
- the ability to transfer to a real person  

**What is happening:**  
The receptionist is ready to answer calls 24/7 for that business.

---

# Part B — A customer calls (live process)

## Step 1 — Customer dials the number
A person picks up their phone and calls the business number.

**What is happening:**  
Nothing smart yet. It is just a normal phone call starting.

---

## Step 2 — The phone line receives the call
The phone provider (Twilio) receives the call on that business’s number.

**What is happening:**  
The system checks: “Which business owns this number?”  
Then it sends the call to that business’s AI receptionist.

---

## Step 3 — The AI receptionist answers quickly
The call is answered almost immediately (target: under one second).

**What is happening:**  
The customer does **not** sit in a queue or hear long hold music.  
The line is picked up right away.

---

## Step 4 — A short pause, then the greeting
After about 1.5 to 2 seconds, the receptionist greets them.

Example:  
“Hello, welcome to Bella Hair Studio. How may I help you today?”

**What is happening:**  
That tiny pause stops the awkward feeling of the AI speaking before the caller is ready.

---

## Step 5 — Normal conversation begins
The customer talks normally:

- “I want a fade tomorrow afternoon”  
- “How much are knotless braids?”  
- “Can I speak to someone?”  

**What is happening:**  
The AI listens and replies in real time, like a phone conversation — not like pressing menu buttons.

---

## Step 6 — If they ask about services or prices
The receptionist does **not** guess.

It asks the business brain for that company’s price list, then answers from those facts.

Example:  
“A Fade & Line-Up starts from R150 and takes about 40 minutes.”

**What is happening:**  
The talking system borrows the truth from the company’s saved information.  
That way the website, phone agent, and emails all stay consistent.

---

## Step 7 — If they ask something the business never provided
The receptionist admits it does not know, and offers help.

Example:  
“I don’t have that information right now — I can get someone to call you back, or transfer you to a person.”

**What is happening:**  
It is not allowed to invent answers.  
This protects the business from wrong promises.

---

## Step 8 — If they want to book
The receptionist collects, through conversation:

1. what service they want  
2. preferred day and time  
3. their name  
4. their phone number  

**What is happening:**  
It behaves like a front-desk person taking details — one question at a time, naturally.

---

## Step 9 — Check if that time is free
Before confirming, the business brain checks the diary.

- If the slot is free → continue  
- If it is taken → offer other times  

**What is happening:**  
This prevents double-booking.  
The AI must never confirm a time that is already full.

---

## Step 10 — Read everything back and get a clear yes
Before saving anything, the receptionist confirms:

“So that’s a Fade & Line-Up for Sipho on Wednesday at 4pm. Shall I book that?”

**What is happening:**  
Nothing is written down until the customer clearly agrees.

---

## Step 11 — Save the booking
Once the customer says yes:

1. the diary gets the appointment  
2. the filing cabinet stores the booking  
3. a booking reference is created (like `BHS-KYM3T`)  

**What is happening:**  
The appointment now exists for real — not just in the conversation.

---

## Step 12 — Confirm out loud
The receptionist tells the customer they are booked and reads the reference.

**What is happening:**  
The customer leaves the call knowing it worked.

---

## Step 13 — Call ends cleanly
Whether the customer hangs up after booking, or earlier, the call session is closed properly.

**What is happening:**  
If the call drops halfway, the system still logs what happened and does not leave anything hanging.

---

# Part C — After the call

## Step 14 — Write the call summary
The system stores:

- who called  
- how long the call was  
- what they wanted  
- the result: booked / enquiry / transferred / unresolved  

**What is happening:**  
The business gets a record of every call, not only successful bookings.

---

## Step 15 — Message the business
An email goes to the studio with the details.

If SMS/WhatsApp confirmation is enabled later, the customer can also get a text.

**What is happening:**  
Staff can see the new booking even if they missed the call.

---

## Step 16 — Optional: update CRM / spreadsheet
The same call outcome can be added as one row in HubSpot or Google Sheets.

**What is happening:**  
The business builds a history of leads and bookings automatically.

---

# Part D — Special cases

## If the customer wants a human
They say things like:

- “I want to speak to a person”  
- “Transfer me to an agent”  

**What happens:**  
The AI transfers the live call to the business’s designated phone number.

---

## If the AI system is down
**What should happen in production:**  
The call falls back to the business’s normal phone number, instead of going unanswered.

---

## If two people call at the same time
**What happens:**  
Each caller gets their own receptionist session.  
One call should not make the other wait.

---

# One full example, start to finish

1. Sipho dials Bella Hair Studio.  
2. The call is answered immediately.  
3. After a short pause: “Hello, welcome to Bella Hair Studio…”  
4. Sipho asks for a fade on Wednesday at 4.  
5. The receptionist checks prices and free times.  
6. 4pm is free.  
7. It confirms name and number.  
8. It reads the booking back.  
9. Sipho says yes.  
10. The appointment is saved in the diary and filing cabinet.  
11. Sipho hears his booking reference.  
12. He hangs up.  
13. The salon gets an email with the booking.  
14. The call is logged as “booked.”  

---

# What each step is doing (quick map)

| Stage | Who is working | Job in plain words |
|---|---|---|
| Dial | Customer | Starts the call |
| Answer | Phone line + call handler | Pick up fast |
| Talk | Call handler (voice AI) | Have the conversation |
| Look up facts | Business brain + filing cabinet | Get real prices / FAQs |
| Check diary | Business brain + calendar | Avoid double-booking |
| Save booking | Business brain + filing cabinet + calendar | Make it official |
| Confirm | Call handler | Tell the customer it’s done |
| After call | Messenger | Email/SMS the business (and later the customer) |
| Human needed | Call handler | Hand the call to a real person |

---

# What we are *not* doing in this phone version

- The customer does **not** need a website or app.  
- The customer does **not** press “1 for bookings.”  
- Your laptop is **not** the place where company data lives.  
- The talking system is **not** allowed to invent prices or policies.  

---

# Closing line for the meeting

> “When someone calls the business number, an AI receptionist answers immediately, uses that company’s real information, books into the real diary only when the slot is free, confirms out loud, and then emails the business. The talking happens in the call system. The memory and bookings live in our business brain and database.”
