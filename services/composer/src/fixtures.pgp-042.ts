// Live PGP pause data from 2026-09-29, copied verbatim from DynamoDB: rule
// 19e2ffa0... (argus-policy-rules rule_content), the signed assessment for
// client 2026-042 on demo event demo-1790716881224-19e2ffa0, and the brief
// Composer drafted from them.

export const PGP_RULE_CONTENT =
  "# Canada takes steps to responsibly manage the Parents and Grandparents Program\n\nOttawa, July 15, 2026—The Government of Canada is taking steps to maintain a well‑managed, sustainable immigration system that works for newcomers and Canadians alike. As part of these efforts, Immigration, Refugees and Citizenship Canada (IRCC) is pausing the intake of new applications under the Parents and Grandparents Program (PGP Program). We will continue to process existing applications and plan to approve up to 15,000 people for permanent residence through the PGP Program in 2026, in line with the 2026–2028 Immigration Levels Plan. This approach will help reduce processing times and improve predictability for families.\n\nFamily reunification remains an important pillar of Canada’s immigration system. Parents and grandparents continue to be able to visit their children and grandchildren in Canada through the super visa, which allows them to visit their children or grandchildren for 5 years at a time and provides multiple entries to Canada for up to 10 years. IRCC recently made the super visa more accessible by implementing changes to the income and health insurance requirements.\n\nInterest in the PGP Program continues to exceed the spaces available under the levels plan. To manage this pressure responsibly, IRCC will not receive new interest to sponsor forms or invite potential sponsors to apply until further notice.";

export const PGP_042_ASSESSMENT = {
  clientId: '2026-042',
  narrative:
    "Client 2026-042 cannot submit a new PGP interest to sponsor form under the current intake pause; however, the rule does not confirm whether this client was an active sponsor candidate. Super visa remains available as an alternative for family visits.",
  recommendedAction:
    "Confirm with client whether they intended to sponsor under PGP. If yes, advise them to await IRCC notice of intake resumption. If no, inform them that super visa is available for parents/grandparents to visit Canada for up to 5 years per entry, with multiple entries valid for up to 10 years.",
  citationSourceUrl: "https://www.canada.ca/en/immigration-refugees-citizenship/news/notices/responsibly-manage-parent-grandparent-program.html",
};

export const PGP_042_BODY =
  "The Government of Canada has paused the intake of new applications under the Parents and Grandparents Program (PGP). This means that you cannot submit a new PGP interest to sponsor form at this time. However, your current status as an active sponsor candidate is not confirmed by the rule.\n\nFor you, this means that if you intended to sponsor under the PGP, you should await further notice from IRCC regarding the resumption of intake. If you did not intend to sponsor under the PGP, you still have the option of a super visa for your parents or grandparents to visit Canada for up to 5 years per entry, with multiple entries valid for up to 10 years.\n\nI recommend confirming with me whether you intended to sponsor under the PGP. If you did, we should wait for IRCC's notice of intake resumption. If you did not, I suggest exploring the super visa option for family visits [here](https://www.canada.ca/en/immigration-refugees-citizenship/news/notices/responsibly-manage-parent-grandparent-program.html).";

export const PGP_042_ACTIONS = ["Confirm with me if you intended to sponsor under the PGP", "Explore the super visa option for family visits", "Await IRCC's notice of intake resumption if you intended to sponsor under the PGP"];
