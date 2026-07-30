const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, ShadingType, BorderStyle, AlignmentType, LevelFormat, convertInchesToTwip,
} = require("docx");

const OLIVE = "57761F";
const GRAY = "666666";
const LIGHT = "F5F1E8";

const p = (text, opts = {}) => new Paragraph({
  children: [new TextRun({ text, size: opts.size ?? 21, bold: opts.bold, italics: opts.italics, color: opts.color })],
  spacing: { after: opts.after ?? 120 },
});
const h1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: t, color: OLIVE })], spacing: { before: 320, after: 160 } });
const h2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: t, color: OLIVE })], spacing: { before: 280, after: 120 } });

const meta = (label, value) => new Paragraph({
  children: [
    new TextRun({ text: `${label} : `, bold: true, size: 20, color: GRAY }),
    new TextRun({ text: value, size: 20, color: GRAY }),
  ],
  spacing: { after: 60 },
});

// Bloc de copy : tableau une cellule, fond crème
function copyBlock(lines) {
  const paras = [];
  lines.forEach((line, i) => {
    if (line.startsWith("SUBJECT:")) {
      paras.push(new Paragraph({
        children: [
          new TextRun({ text: "Objet : ", bold: true, size: 20, color: GRAY }),
          new TextRun({ text: line.replace("SUBJECT:", "").trim(), bold: true, size: 21 }),
        ],
        spacing: { after: 140 },
      }));
    } else if (line === "") {
      paras.push(new Paragraph({ children: [], spacing: { after: 60 } }));
    } else {
      paras.push(new Paragraph({
        children: [new TextRun({ text: line, size: 21, font: "Helvetica" })],
        spacing: { after: 40 },
      }));
    }
  });
  return new Table({
    columnWidths: [9360],
    width: { size: 9360, type: WidthType.DXA },
    rows: [new TableRow({
      children: [new TableCell({
        width: { size: 9360, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: LIGHT },
        margins: { top: 160, bottom: 160, left: 220, right: 220 },
        borders: {
          top: { style: BorderStyle.SINGLE, size: 4, color: "DDD5C4" },
          bottom: { style: BorderStyle.SINGLE, size: 4, color: "DDD5C4" },
          left: { style: BorderStyle.SINGLE, size: 4, color: "DDD5C4" },
          right: { style: BorderStyle.SINGLE, size: 4, color: "DDD5C4" },
        },
        children: paras,
      })],
    })],
  });
}

const note = (t) => new Paragraph({
  children: [new TextRun({ text: `💡 ${t}`, size: 20, italics: true, color: GRAY })],
  spacing: { before: 100, after: 200 },
});

const spacer = () => new Paragraph({ children: [], spacing: { after: 120 } });

const children = [];

// ============ TITRE + INTRO ============
children.push(new Paragraph({
  children: [new TextRun({ text: "Quinta do Amor — la chaîne d'emails complète", color: OLIVE, bold: true, size: 40 })],
  spacing: { after: 200, line: 320 },
}));
children.push(p("Du premier contact jusqu'à l'après-séjour. Ta structure, complétée des maillons qui manquaient. Chaque email a un draft en anglais dans ton ton — conversationnel, chaleureux, sans superlatifs — que tu peux retravailler directement dans ce document. On intègre ensuite ensemble, email par email.", { color: GRAY, after: 200 }));
children.push(p("Conventions pour tous les emails : Helvetica 13px · expéditeur hello@quintamor.com · signature automatique (site, téléphone, dispos, photos) · placeholders |first name|, |dates|, |amount| remplis automatiquement.", { size: 20, italics: true, color: GRAY, after: 100 }));
children.push(p("Statuts : ✅ existe déjà · 🔧 à construire · ✋ manuel (volontairement).", { size: 20, italics: true, color: GRAY, after: 240 }));

// Réponses à tes deux questions
children.push(h2("Tes deux questions, d'abord"));
children.push(p("Calendly : oui, clairement. Un lien \"grab a 20-minute call\" dans le mail auto réduit les allers-retours écrits et convertit les indécis — et ton mining d'emails montre que les threads les plus longs de l'année sont ceux où un appel aurait tout réglé en 15 minutes. Garde quand même la porte \"or simply reply\" pour ceux qui n'aiment pas les calendriers.", { after: 140 }));
children.push(p("Bouton \"Start scenario\" : oui aussi. Un booking créé dans l'admin ne déclenche rien tant que tu n'appuies pas sur le bouton — tu peux donc créer la fiche tôt, chasser le NIF, finaliser les détails, puis lancer la machine (email 4 + toute la suite) quand TOUT est prêt. C'est le bon garde-fou, je le construirai sur la fiche booking.", { after: 240 }));

// ============ PHASE A ============
children.push(h1("Phase A — Avant la réservation"));

children.push(h2("1. Réponse automatique à la demande (formulaire)"));
children.push(meta("Déclencheur", "Formulaire du site — envoi automatique ~8 minutes après"));
children.push(meta("Statut", "✅ existe — copy ci-dessous à mettre à jour (ajout Calendly)"));
children.push(meta("Objectif", "Répondre avant tout le monde, donner les 3 liens qui répondent à 80 % des questions, ouvrir la porte à un appel"));
children.push(copyBlock([
  "SUBJECT: Your retreat at Quinta do Amor 🌱",
  "Hi |first name|,",
  "",
  "Thank you for considering Quinta do Amor for your retreat. 🌱",
  "",
  "To help answer most of your questions, we've put together a few helpful links:",
  "",
  "💌 Download our brochure — for a detailed overview of what we offer",
  "🗓️ Check our availabilities — to see which dates are currently open",
  "📸 More pictures of our venue — for a closer look at the space and its surroundings",
  "",
  "If you'd like to talk it through, you can grab a 20-minute call with me here: [Calendly link] — or simply reply to this email and we'll find a time.",
  "",
  "And if you'd like to come see the place with your own eyes, you're welcome — just ask.",
  "",
  "With amor,",
  "Geo",
]));
children.push(note("Ton copy d'origine, resserré : le Calendly remplace le vague \"hop on a call feel free to ask\" par une action concrète. La visite sur place reste en dernière ligne — c'est ton meilleur taux de conversion."));

children.push(h2("2. Questions après lecture"));
children.push(meta("Statut", "✋ manuel — et c'est bien ainsi"));
children.push(meta("Objectif", "Répondre vite et personnellement"));
children.push(p("Pas de template : c'est ta valeur ajoutée. Deux munitions pour aller plus vite : la FAQ en annexe de ce document (à intégrer à la brochure — elle répond aux ~20 questions qui reviennent vraiment), et des réponses type pour les 3 sujets les plus fréquents (dispos, prix détaillé rental + catering par personne, configuration des chambres).", { after: 200 }));

children.push(h2("3. Négociation de prix"));
children.push(meta("Statut", "✋ manuel"));
children.push(p("Rien à automatiser ici. Une seule règle issue de tes propres threads : chaque concession par écrit, jamais par téléphone seul — et on enchaîne immédiatement sur le récap (3bis).", { after: 200 }));

children.push(h2("3bis. Récap d'accord  (NOUVEAU)"));
children.push(meta("Déclencheur", "Manuel — dès qu'on est d'accord sur l'essentiel, avant le paiement"));
children.push(meta("Statut", "✋ manuel (template à disposition)"));
children.push(meta("Objectif", "Une seule source de vérité écrite : dates, prix, inclus/exclus. Évite 100 % des malentendus au moment de payer"));
children.push(copyBlock([
  "SUBJECT: Recap of what we agreed",
  "Hi |first name|,",
  "",
  "Lovely talking to you. Here's a quick recap so we're looking at the same picture:",
  "",
  "· Dates: |check-in| → |check-out| (|nights| nights)",
  "· Exclusive rental: €|rental total|, taxes included",
  "· Catering: from €|pp|/person/day full board (final menu chosen ~1 month before)",
  "· Included: the full property — 11 bedrooms, the Barn, both pools, sauna, ice bath — plus linen, cleaning and on-site support",
  "",
  "If anything looks off, tell me and I'll fix it. Whenever you're ready, I'll send the booking confirmation with the deposit link.",
  "",
  "Warmly,",
  "Geo",
]));
children.push(note("Le maillon qui manquait entre la négo et le paiement. C'est aussi ce mail qui rend l'email 4 très court."));

// ============ PHASE B ============
children.push(h1("Phase B — Réservation"));

children.push(h2("4. Confirmation de booking + acompte 30 %"));
children.push(meta("Déclencheur", "Bouton \"Start scenario\" sur la fiche booking (🔧 à construire) — tu crées le booking quand tu veux, la machine part quand tu cliques"));
children.push(meta("Statut", "🔧 semi-existant — l'icône ✉️ d'aujourd'hui envoie déjà la demande de paiement ; il manque le bouton Start scenario, le hold 7 jours et ce texte dédié"));
children.push(meta("Objectif", "Enthousiasme + un seul geste à faire (payer) + cadre clair (7 jours, conditions)"));
children.push(copyBlock([
  "SUBJECT: Let's make it official — your dates at Quinta do Amor",
  "Hi |first name|,",
  "",
  "Really happy we're doing this — I'll be here to support you all the way through.",
  "",
  "To confirm your booking, here's the deposit (30% of the rental):",
  "",
  "[ Pay €|deposit| ]",
  "",
  "Your dates are on hold for you for the next 7 days.",
  "",
  "Completing this payment confirms your booking and our General Conditions & Cancellation Policy [link].",
  "",
  "Once it's in, you'll receive access to your guest area — where transport, food and bedrooms for your stay all come together in one place.",
  "",
  "Warmly,",
  "Geo",
]));
children.push(note("La ligne conditions générales est la couche légale dont on a parlé : paiement = acceptation, avec le lien vers le PDF versionné. À coupler avec la case à cocher dans le checkout Stripe (en attente de ton PDF Canva)."));

children.push(h2("4bis. Relance hold — J+5 sans paiement"));
children.push(meta("Déclencheur", "Automatique : 5 jours après l'email 4 si l'acompte n'est pas payé"));
children.push(meta("Statut", "🔧 à construire"));
children.push(copyBlock([
  "SUBJECT: Your dates at Quinta do Amor — 2 days left",
  "Hi |first name|,",
  "",
  "A gentle nudge — your dates are on hold until |hold end date|. Without the deposit by then, they'll show as available again in our calendar, and I'd hate that for you.",
  "",
  "[ Pay €|deposit| ]",
  "",
  "If the timing is tricky on your side, just tell me — we can usually figure something out.",
  "",
  "Warmly,",
  "Geo",
]));

children.push(h2("5. Confirmation d'acompte + media pack"));
children.push(meta("Déclencheur", "Automatique — paiement Stripe confirmé (webhook)"));
children.push(meta("Statut", "✅ existe (facture jointe) — à enrichir avec les next steps et le media pack"));
children.push(meta("Objectif", "Rassurer, créer l'excitation, armer son marketing"));
children.push(copyBlock([
  "SUBJECT: It's official — the Quinta is yours",
  "Hi |first name|,",
  "",
  "Good news, your deposit of €|amount| has arrived safely — |dates| are officially yours. Your invoice is attached.",
  "",
  "Two things to get you started:",
  "",
  "· Your guest area invitation follows in a separate email — two clicks and you're in. That's where transport, food and bedrooms come together as your retreat takes shape.",
  "· To help you promote your retreat: our full media pack — photos and drone footage [Pixieset link]. Use anything you like.",
  "",
  "I'll be in touch as your stay gets closer. Anything you need before then, just reply.",
  "",
  "Warmly,",
  "Geo",
]));
children.push(note("L'invitation guest area (email existant, texte déjà validé ensemble) part juste après — c'est le 5bis. La cliente entre dans l'outil dès le jour 1, exactement ta vision."));

// ============ PHASE C ============
children.push(h1("Phase C — Préparation du séjour"));

children.push(h2("6. Solde — J-60"));
children.push(meta("Déclencheur", "Automatique à J-60 (ou manuel via l'icône ✉️, comme aujourd'hui)"));
children.push(meta("Statut", "✅ l'outil d'envoi existe · 🔧 le déclenchement auto J-60 à construire"));
children.push(copyBlock([
  "SUBJECT: Your stay at Quinta do Amor — final payment",
  "Hi |first name|,",
  "",
  "I hope you're doing well!",
  "",
  "Your stay at Quinta do Amor from |dates| is getting close.",
  "",
  "Here's the link for the remaining balance:",
  "",
  "[ Pay €|balance| ]",
  "",
  "Your invoice will arrive in your inbox as soon as the payment comes through.",
  "",
  "If anything feels unclear, just reply to this email, I'm happy to help.",
  "",
  "Looking forward to welcoming you soon.",
  "",
  "Warmly,",
  "Geo",
]));

children.push(h2("6bis. Rappels de solde"));
children.push(meta("Déclencheur", "Automatique : J-7 avant échéance, puis J+3 si retard"));
children.push(meta("Statut", "✅ l'infrastructure existe (interrupteur global encore éteint) — textes ci-dessous à valider"));
children.push(copyBlock([
  "SUBJECT: (J-7)  Friendly heads-up — balance due |due date|",
  "Hi |first name|, a friendly heads-up: the balance for your stay is due on |due date|. Here's the link whenever you're ready: [ Pay €|balance| ]. Warmly, Geo",
  "",
  "SUBJECT: (J+3)  About your balance",
  "Hi |first name|, it looks like the balance (due |due date|) hasn't come through yet — if you've already sent it, please ignore me! Otherwise here's the link: [ Pay €|balance| ]. Any hiccup on your side, just reply. Warmly, Geo",
]));

children.push(h2("7. Confirmation du solde"));
children.push(meta("Statut", "✅ existe — même mécanique que le 5 (auto, facture jointe, \"fully settled\")"));
children.push(spacer());

children.push(h2("8. J-45 — Transportation"));
children.push(meta("Statut", "🔧 à construire (lien direct guest area)"));
children.push(copyBlock([
  "SUBJECT: Getting everyone to the Quinta",
  "Hi |first name|,",
  "",
  "Time to think about arrivals. In your guest area you can plan the transfers for your whole group — airport pick-ups, timings, luggage:",
  "",
  "[ Plan your transportation ]",
  "",
  "Private drivers from the airport: €60 per 4-seat car, €80 per 6-seat. If most of your group lands around the same time, we'll line the cars up so nobody waits.",
  "",
  "Warmly,",
  "Geo",
]));

children.push(h2("9. J-30 — Food options"));
children.push(meta("Statut", "🔧 à construire"));
children.push(copyBlock([
  "SUBJECT: Let's talk food",
  "Hi |first name|,",
  "",
  "One of the best parts. In your guest area you can now choose the menu for your group — vegetarian or with fish & meat, day by day, with prices per person as you go:",
  "",
  "[ Choose your food options ]",
  "",
  "Dietary needs — vegan, gluten-free, allergies — are all fine: note them there and our chefs will take care of the rest.",
  "",
  "Warmly,",
  "Geo",
]));

children.push(h2("10. J-15 — Bedrooms"));
children.push(meta("Statut", "🔧 à construire"));
children.push(copyBlock([
  "SUBJECT: Bedrooms — last stretch",
  "Hi |first name|,",
  "",
  "Time to set up the bedrooms. In your guest area you can arrange your group across the 11 rooms — twins or doubles, who sleeps where:",
  "",
  "[ Arrange the bedrooms ]",
  "",
  "One small deadline: changes close in 5 days so we can prepare the house properly for you.",
  "",
  "Warmly,",
  "Geo",
]));

children.push(h2("11. J-10 — Résumé des options"));
children.push(meta("Statut", "🔧 à construire (le résumé existe déjà dans la guest area — il s'agit de l'envoyer)"));
children.push(copyBlock([
  "SUBJECT: Your stay, at a glance",
  "Hi |first name|,",
  "",
  "Everything is now locked in. Here's the summary of your choices — rooms, meals, transfers:",
  "",
  "[ résumé généré depuis la guest area ]",
  "",
  "Spot anything off? Reply today and we'll sort it out. Otherwise there's nothing more for you to do — we're preparing the house.",
  "",
  "Warmly,",
  "Geo",
]));

children.push(h2("12. J-7 — Facture catering"));
children.push(meta("Statut", "✅ l'outil existe (échéance catering + icône ✉️) · 🔧 déclenchement auto"));
children.push(copyBlock([
  "SUBJECT: Catering for your stay",
  "Hi |first name|,",
  "",
  "Here's the catering for your stay, based on the menu you chose:",
  "",
  "[ Pay €|catering| ]",
  "",
  "Anything added during the stay — extra transfers, activities, the honesty bar — goes on a small final invoice after you leave, so there are no surprises mid-week.",
  "",
  "Warmly,",
  "Geo",
]));

children.push(h2("13. J-3 — Guide d'arrivée"));
children.push(meta("Statut", "🔧 à construire"));
children.push(copyBlock([
  "SUBJECT: Finding us — your arrival guide",
  "Hi |first name|,",
  "",
  "Three days! Here's everything for a smooth landing:",
  "",
  "· Address: Quinta do Amor, |adresse| — [Google Maps link]",
  "· Route: |notes route — dernier tronçon, parking|",
  "· Check-in from 3pm — if you'd like to arrive earlier to set up as the host, tell me and we'll arrange it",
  "· My number: +351 931 377 682 — WhatsApp works anytime",
  "",
  "Travel safe. See you |day|.",
  "",
  "Geo",
]));

// ============ PHASE D ============
children.push(h1("Phase D — Séjour & après  (les maillons ajoutés)"));

children.push(h2("14. J+1 — Merci  (NOUVEAU)"));
children.push(meta("Statut", "🔧 à construire (ou manuel au début)"));
children.push(copyBlock([
  "SUBJECT: Thank you",
  "Hi |first name|,",
  "",
  "The house feels quiet without your group. Thank you for choosing the Quinta — it was a real pleasure hosting you.",
  "",
  "If anything was consumed on site (extras, transfers, the honesty bar), the final invoice follows in the next few days.",
  "",
  "Warmly,",
  "Geo",
]));

children.push(h2("15. J+4 — Feedback, avis & photos  (NOUVEAU)"));
children.push(meta("Statut", "🔧 à construire"));
children.push(meta("Objectif", "Le feedback améliore le lieu, l'avis public amène les prochains leaders, les photos nourrissent ton marketing"));
children.push(copyBlock([
  "SUBJECT: One small favour",
  "Hi |first name|,",
  "",
  "Now that you've landed home — two small things.",
  "",
  "If you have three minutes, I'd love your honest feedback: what worked, and what we could do better next time.",
  "",
  "And if you're happy to share it publicly, a short review helps other retreat leaders find us: [Google review link].",
  "",
  "If you took photos you love, we'd be happy to see them — and we'll gladly share ours from your week.",
  "",
  "Warmly,",
  "Geo",
]));

children.push(h2("16. Ouverture de la saison suivante  (NOUVEAU)"));
children.push(meta("Déclencheur", "Campagne annuelle (ex. octobre, à l'ouverture du calendrier) vers tous les leaders de l'année"));
children.push(meta("Statut", "🔧 campagne manuelle assistée"));
children.push(meta("Objectif", "Le rebooking est ton revenu le moins cher — les leaders qui reviennent ne se négocient presque pas"));
children.push(copyBlock([
  "SUBJECT: 2027 dates are opening",
  "Hi |first name|,",
  "",
  "We're opening the 2027 calendar — and returning leaders pick first. That's you.",
  "",
  "If you're thinking about coming back, tell me your ideal window before |date| and I'll pencil it in.",
  "",
  "Either way — lovely to have hosted you this year.",
  "",
  "Warmly,",
  "Geo",
]));

// ============ FAQ ============
children.push(h1("Annexe — FAQ pour la brochure"));
children.push(p("Construite à partir de ~25 vraies conversations avec des retreat leaders sur les 12 derniers mois. Chaque réponse vient de TES réponses écrites — rien d'inventé. Trois points restent à trancher par toi (marqués TODO).", { color: GRAY, after: 200 }));

const faq = [
  ["How many guests can sleep at the Quinta?", "22 guests, in 11 bedrooms (22 beds) with 8 bathrooms."],
  ["Can rooms be set up as twins or doubles?", "All rooms except two can be arranged as double or twin; twins convert into queens (not the reverse). Single occupancy for 20+ people isn't possible with 11 bedrooms — a room-layout chart is available."],
  ["Can you host more than 22 people?", "Yes — a trusted glamping partner sets up a tented village next to the Barn (quoted per case; not recommended after late October). Simple garden tents: €10/person/night."],
  ["Do we get the whole property to ourselves?", "Always. The Quinta is rented exclusively — sole use of the 20 hectares, inside the Arrábida Natural Park, for your whole stay."],
  ["What is the practice space like?", "The Barn: ~200 m², fits ~30 for workshops, microcement floor (great barefoot), sound system included, unlimited use. Outdoor sessions on the lawn by the pool. The Barn isn't heated — the house itself is (A/C + fireplace)."],
  ["Do you provide yoga props?", "Mats, blocks and bolsters on site (no straps). Massage table planned as included from 2027."],
  ["How much does the venue cost?", "Exclusive rental priced per stay, regardless of guest count, all taxes included — e.g. €15,300 for 7 days (2026). Includes all rooms, the Barn, both pools, sauna, ice bath, tennis and beach-volley courts, Wi-Fi, linen, cleaning and on-site support."],
  ["What is the minimum stay?", "TODO Geo : trancher 3 vs 4 nuits (les deux ont été annoncés cette année) — et préciser si retraites et célébrations diffèrent."],
  ["How do deposit and payments work?", "30% deposit to secure the dates, balance closer to the stay, catering invoiced separately. Paying the deposit confirms the booking and the General Conditions & Cancellation Policy."],
  ["What is the cancellation policy?", "TODO Geo : mettre les termes clés en toutes lettres ici (aujourd'hui : lien Canva uniquement)."],
  ["Can you hold dates while we sell our retreat?", "Courtesy holds are possible (typically a few days) — with the promise that any competing interest is flagged immediately."],
  ["Is there a security deposit?", "€1,000, refundable. Normal wear and tear is expected; any deduction is proportional to actual damage."],
  ["Are you insured?", "Public liability up to €300,000 per claim for anything caused by the property. Injuries during practice aren't covered — participants should have their own insurance."],
  ["What does full board cost?", "Per person per day, VAT incl. (2026): vegetarian €70 · fish/meat at dinner €78 · fish/meat at lunch & dinner €85. Unlimited coffee, tea, fruit and snacks all day. Local, largely farm-grown organic produce. (2027: +€2–7/day.)"],
  ["Can you handle vegan / gluten-free / mixed groups?", "Yes, entirely — vegetarians are fully catered for on fish/meat days, and dietary needs are the chefs' daily bread."],
  ["Can we bring our own food or caterer?", "The Quinta is the exclusive caterer (food, drinks, bar). Exceptions: your own wine is welcome (there's also a local-wine honesty bar), plus personal touches like a cake or ceremonial cacao."],
  ["Do facilitators eat free?", "TODO Geo : confirmer les seuils exacts (1 facilitateur offert au-delà de 16 guests, 2 au-delà de 20 — des seuils 12/16 ont aussi circulé)."],
  ["How do we get there from Lisbon airport?", "~50 minutes. Private drivers: €60 per 4-seat car, €80 per 6-seat. Shuttles for excursions on request (beach ~€20/car, wineries ~€30/way)."],
  ["What is nearby?", "Arrábida's award-winning beaches (10 min drive), hiking from the doorstep (incl. a ~2h30 hike to Portinho da Arrábida), surfing 30 min away, wine tastings in Azeitão (~€20 pp)."],
  ["Is the Wi-Fi reliable? Are rooms air-conditioned?", "Wi-Fi is reliable for everyday use (countryside honesty: not lightning-fast). Every bedroom has A/C — which also heats."],
  ["Are the pools heated?", "No — like most pools in Portugal. They reach ~28°C naturally by late May. Two pools, plus sauna and ice bath."],
  ["What activities can you arrange?", "Cooking class €20–50 pp, azulejos tile painting €25 pp, sound bath €40 pp, massages on site, breathwork, ice bath sessions, boat trips, guided hikes ~€25 pp — direct contact with facilitators, no commission."],
  ["Can we visit before booking?", "With pleasure — between groups only (guest privacy). Ask and we'll find a window."],
  ["When are you open?", "Season runs 1 May → 1 November (winter is for renovations). 2026 sold out almost entirely — for 2027, the live calendar on the website is always current, and a cancellation waitlist exists."],
];

faq.forEach(([q, a]) => {
  children.push(new Paragraph({
    children: [new TextRun({ text: q, bold: true, size: 21 })],
    spacing: { before: 160, after: 60 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: a, size: 21, color: a.startsWith("TODO") ? "B45309" : "222222" })],
    spacing: { after: 100 },
  }));
});

children.push(spacer());
children.push(p("Les 3 questions les plus posées de l'année : 1) les disponibilités (dans presque chaque demande — ton mail auto y répond), 2) le prix total détaillé rental + catering par personne (tes meilleurs threads sont ceux où tu envoies un chiffrage itemisé), 3) la capacité et la configuration des chambres (aussi la 1ère cause de deal perdu — la réponse glamping mérite d'être dans la brochure).", { italics: true, color: GRAY, after: 200 }));

const doc = new Document({
  styles: {
    default: {
      document: { run: { font: "Inter", size: 21 }, paragraph: { spacing: { line: 300 } } },
    },
  },
  sections: [{ properties: {}, children }],
});

Packer.toBuffer(doc).then((buf) => {
  require("fs").writeFileSync("/home/claude/quinta-guest-area/previews/quinta_email_chain.docx", buf);
  console.log("OK", buf.length);
});
