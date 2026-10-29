
/**
 * Register a manager's phone number for inbound voice routing.
 *
 * Usage: node scripts/add-manager-phone.mjs <user email> <phone number in E.164>
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.
 */

const [, , email, phone] = process.argv;

if (!email || !phone) {
  console.error("Usage: node scripts/add-manager-phone.mjs <user email> <phone number in E.164>");
  process.exit(1);
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

async function run() {
  // 1. Find the user ID
  let res = await fetch(`${supabaseUrl}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=id`, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
    },
  });
  
  if (!res.ok) throw new Error(`User lookup failed: ${await res.text()}`);
  const users = await res.json();
  if (users.length === 0) throw new Error(`User with email ${email} not found.`);
  const userId = users[0].id;

  // 2. Insert the phone number
  res = await fetch(`${supabaseUrl}/rest/v1/manager_phone_numbers`, {
    method: "POST",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ user_id: userId, phone_number: phone }),
  });

  if (!res.ok) {
    const error = await res.text();
    if (error.includes("duplicate key value") || error.includes("manager_phone_numbers_user_id_phone_number_key")) {
      console.log(`Phone number ${phone} is already registered for ${email}.`);
      return;
    }
    throw new Error(`Failed to insert phone number: ${error}`);
  }

  console.log(`Successfully registered ${phone} for manager ${email}.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
