// Probe matrix for the argus-safety phone regexes. The same strings were run
// through ApplyGuardrail on the live guardrail with the PHONE entity, INPUT
// and OUTPUT, before the entity was swapped for regexes.

// Argus text with no client PII. None of these may be blocked. The PHONE
// entity blocked every one marked "entity blocked".
export const phoneMustPass = [
  'Client 2026-042 is sponsoring parents under PGP.',
  'File F-2026-042 is affected by the new PGP intake rule.',
  'Client C-101 is not affected by this change.',
  'Call client 2026-042 about the new rule.', // entity blocked
  'Contact client F-2026-042 before the deadline.', // entity blocked
  'Phone the RCIC about client C-101.',
  'Eligible occupations: NOC 21231, 41220 and 93888.',
  'Client 2026-061 (NOC 93888) and client 2026-042 (NOC 41220) both need review.',
  'Call about NOC 21231 eligibility for client 2026-042.', // entity blocked
  'The cutoff rose to 491, so a CRS of 489 no longer clears it.',
  'Client 2026-042 has a CRS of 489 and CLB 9 in all four abilities.',
  'CIP code 52.0201 is no longer on the PGWP eligible list.',
  'Graduation date 2026-09-28 falls after the 2026-06-25 cutoff.',
  'The draw on 2026-09-28 invited 3,000 candidates with a cutoff of 489.',
  'LICO must be met for the 2023, 2024 and 2025 tax years.',
  'Program year 2026-2027 intake opens on 2026-10-14.',
  'Submit IMM 5669 and IMM 5406 with the application.',
  'Form IMM 0008 Schedule A is required for each family member aged 18 or older.',
  'IRCC processing time for spousal sponsorship outside Quebec is 13 months.',
  'Processing times: 180 days for PGWP, 112 days for study permits inside Canada.',
  'The right of permanent residence fee is $575 and the processing fee is $950, for a total of $1,525.',
  'Fees rose from $1,365 to $1,525 on 2026-04-30.',
  'Call the IRCC call centre at 1-888-242-2100 for case-specific questions.', // entity blocked
  'The IRCC Client Support Centre number is 1-888-242-2100.', // entity blocked
  'Phone 1-888-242-2100 (in Canada only), Monday to Friday, 8 am to 4 pm.', // entity blocked
  '{"clientId":"2026-014","nocCode":"64100","teerLevel":4,"currentCrsScore":402,"delta":-12}',
  '2026-042 2026-061 2026-011', // entity blocked
  'Rule hash 9f86d081884c7d65 applied to client 2026-042 on 2026-09-28.', // entity blocked
  'Clients 2026-0042 and 2026-0061 move from eligible to ineligible.',
  'Contact: RCIC R712345, client 2026-042, NOC 41220, CRS 489.', // entity blocked
  'Reach out to client 2026-042 re: IMM 5669 by 2026-10-05.', // entity blocked
  'Tel: see client file 2026-042.', // entity blocked
  'Client 2026-042, 2026-09-28, NOC 93888, CLB 9.', // entity blocked
  'The invitation round 312 on 2026-09-28 had a tie-breaking time of 2026-09-01 14:32:10 UTC.',
  'Minimum necessary income for a family of 4 is $65,142 for 2025.',
  'Settlement funds for a family of 3 rose to $26,006.',
  'Section 117(1)(c) of the IRPR applies to client 2026-042.',
  'Express Entry draw 312: 1,500 invitations, CRS 489, category French-language proficiency.',
  'Call centre wait times averaged 42 minutes in 2026-08.',
  'Client 2026-042 scored 67 points on the FSW grid.',
  'The Atlantic Immigration Program cap for 2026 is 4,000 nominations.',
  'Client 20260042 is now ineligible.',
  'Case reference E001234567 is on file for client 2026-042.', // entity blocked
  'Application number B000123456 was received on 2026-09-28.',
  'UCI 1122-3344 is not client PII in Argus. Use client_id 2026-042.',
  'NOC 2021 version 1.0 replaced NOC 2016 on 2022-11-16.',
  'Phone interview scheduled for client 2026-042 on 2026-10-01 at 10:30.', // entity blocked
  'Service Canada is at 1-800-622-6232.', // entity blocked
  'The test is booked for 01.09.2026 at the Ottawa centre.',
  'Clients 2026-042 2026-061 2026-011 need review.', // entity blocked
  // Short sentences with a bare client ID. The demo tenant uses YYYY-NNN IDs.
  'Client 2026-042 is affected.',
  'Client 2026-011 is affected.',
  'Client 2026-061 is affected.',
  'Client C-101 is affected.',
  'Client F-2026-042 is affected.',
  'Client 2026-0042 is affected.',
  'Client 20260042 is affected.',
  'Client 26-042 is affected.',
  'Client 2026/042 is affected.',
  'Client 2026.042 is affected.',
  'Client ID: 2026-042',
  'File 2026-042.',
  '2026-042',
  'Client 2026-042 is not affected.',
  'Client 2026-042 moves to ineligible.',
];

// Real phone number shapes. Every one must stay blocked. The PHONE entity
// blocked all of them.
export const phoneMustBlock = [
  'Call the client at 613-555-0142.',
  "The client's phone is (416) 555-0199.",
  'Reach her on +1 604 555 0123 after 5 pm.',
  'Client phone 6135550142.',
  'Her UK number is +44 20 7946 0958.',
  'Contact 613.555.0142 for the applicant.',
  'Cell: 1-613-555-0142.',
  'Phone (613) 555-0142 ext. 204.',
  'Mobile +16135550142.',
  'His number in France is +33 1 42 68 53 00.',
  'WhatsApp +91 98765 43210.',
  'Update the file: 416 555 0199 is the new contact.',
  'The applicant can be reached at 613 555 0142.',
  'Client number (604)555-0123.',
  'Her London number is 020 7946 0958.',
  'Dial 0044 20 7946 0958 from Canada.',
  'Office +44 (0)20 7946 0958.',
  'Her Russian mobile is +7 912 345 67 89.',
  'Her Paris number is 01 42 68 53 00.',
  '{"clientId":"2026-042","phone":"+1-613-555-0142"}',
];
