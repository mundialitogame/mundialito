// Builds src/data/squads.json from data-cache/squads.raw.json.
// Rating model: hand-curated overalls for known players, otherwise a
// heuristic from club tier + caps + age + nation strength. Sub-stats come
// from position archetypes with deterministic per-player jitter.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const raw = JSON.parse(readFileSync(new URL("../data-cache/squads.raw.json", import.meta.url), "utf-8"));

// ---------------------------------------------------------------- club tiers
// 1 elite .. 6 minor. Unlisted clubs default to 5 (national-league level).
const T = {
  1: ["Real Madrid", "Barcelona", "Manchester City", "Liverpool", "Paris Saint-Germain", "Bayern Munich", "Arsenal", "Inter Milan", "Chelsea"],
  2: ["Atlético Madrid", "Manchester United", "Tottenham Hotspur", "Newcastle United", "Borussia Dortmund", "Bayer Leverkusen", "Milan", "Juventus", "Napoli", "Aston Villa", "Crystal Palace", "Sporting CP", "Benfica", "Porto", "Atalanta", "RB Leipzig", "Brighton & Hove Albion", "Nottingham Forest", "Roma", "Marseille", "Monaco", "Athletic Bilbao", "Real Sociedad", "Villarreal", "Real Betis", "Eintracht Frankfurt", "VfB Stuttgart", "Bologna", "Lille", "Nice", "Lyon", "Fiorentina", "Sevilla", "Brentford", "Fulham", "Bournemouth", "West Ham United", "Everton", "Wolverhampton Wanderers", "Sunderland", "Leeds United", "Como", "Feyenoord", "PSV Eindhoven", "Ajax", "Celtic", "Rangers", "Galatasaray", "Fenerbahçe", "Al-Hilal", "Al-Nassr", "Al-Ahli", "Al-Ittihad", "Flamengo", "Palmeiras", "River Plate", "Boca Juniors", "Girona", "Strasbourg", "TSG Hoffenheim", "SC Freiburg", "Mainz 05", "Borussia Mönchengladbach", "VfL Wolfsburg", "Werder Bremen", "Burnley", "Wolfsburg", "Torino", "Udinese", "Genoa", "Sassuolo", "Cagliari", "Rennes", "Lens", "Toulouse", "Reims", "Le Havre", "Lorient", "Club Brugge", "Anderlecht", "Union Saint-Gilloise", "Genk", "Antwerp", "Braga", "Olympiacos", "Panathinaikos", "PAOK", "Red Bull Salzburg", "Copenhagen", "Midtjylland", "Nordsjælland", "Brøndby", "Zenit Saint Petersburg", "Krasnodar", "Al Ahly", "Pisa", "Cremonese", "Venezia", "Parma", "Coventry City", "Watford", "Norwich City", "Stoke City", "Hull City", "Derby County", "Swansea City", "Birmingham City", "Middlesbrough", "Southampton", "Leicester City", "Sheffield United", "Ipswich Town", "Hamburger SV", "FC St. Pauli", "Holstein Kiel", "FC Augsburg", "1. FC Union Berlin", "Heidenheim", "Celta Vigo", "Rayo Vallecano", "Mallorca", "Osasuna", "Getafe", "Valencia", "Espanyol", "Alavés", "Levante", "Oviedo", "Elche", "Dinamo Zagreb", "Hajduk Split", "Rijeka", "Red Star Belgrade", "Slavia Prague", "Viktoria Plzeň", "Sparta Prague", "Beşiktaş", "Trabzonspor", "Samsunspor", "Başakşehir", "İstanbul Başakşehir", "Kasımpaşa", "Çaykur Rizespor", "Pafos", "AEK Athens", "Maccabi Haifa", "Grêmio", "Botafogo", "Corinthians", "Santos", "São Paulo", "Internacional", "Atlético Mineiro", "Fluminense", "Vasco da Gama", "Cruzeiro", "Athletico Paranaense", "Rosario Central", "Racing", "Independiente", "Vélez Sarsfield", "Estudiantes", "Huracán", "Lanús", "Talleres", "Inter Miami CF", "Los Angeles FC", "LA Galaxy", "Columbus Crew", "FC Cincinnati", "Seattle Sounders FC", "Atlanta United FC", "Philadelphia Union", "América", "Guadalajara", "Cruz Azul", "UANL", "Monterrey", "Toluca", "UNAM", "Pachuca", "Tijuana", "Santos Laguna", "Atlas", "Pumas", "Al-Sadd", "Al-Duhail", "Al-Rayyan", "Al-Wakrah", "Al Ain", "Al-Qadsiah", "Al-Ettifaq", "Al-Shabab", "Persepolis", "Esteghlal", "Tractor", "Sepahan", "Mamelodi Sundowns", "Orlando Pirates", "Kaizer Chiefs", "Pyramids", "Zamalek", "RS Berkane", "AS FAR", "Wydad AC", "Raja CA", "Espérance de Tunis", "Young Boys", "Basel", "Bodø/Glimt", "Malmö FF", "AIK", "FC Tokyo", "Kashima Antlers", "Urawa Red Diamonds", "Vissel Kobe", "Yokohama F. Marinos", "Sanfrecce Hiroshima", "Machida Zelvia", "Kawasaki Frontale", "Gamba Osaka", "Cerezo Osaka", "Jeonbuk Hyundai Motors", "Ulsan HD", "FC Seoul", "Sint-Truiden", "NEC", "AZ", "Twente", "Utrecht", "Heerenveen", "Dender", "Mechelen", "Charleroi", "Standard Liège", "Kifisia", "Lokomotiv Moscow", "Dynamo Moscow", "CSKA Moscow", "Spartak Moscow", "Shakhtar Donetsk", "Dynamo Kyiv", "Wolfsberger AC", "LASK", "Sturm Graz", "Austria Wien", "Rapid Wien"]
};
// pull tier-2 list apart: first 9 of T[1] are tier 1; everything in T[2.. ] keyed below
const CLUB_TIER = new Map();
for (const c of T[1]) CLUB_TIER.set(c, 1);
const TIER2 = ["Atlético Madrid", "Manchester United", "Tottenham Hotspur", "Newcastle United", "Borussia Dortmund", "Bayer Leverkusen", "Milan", "Juventus", "Napoli", "Aston Villa", "Crystal Palace", "Sporting CP", "Benfica", "Porto", "Atalanta", "RB Leipzig", "Brighton & Hove Albion", "Nottingham Forest", "Roma", "Marseille", "Monaco", "Athletic Bilbao", "Real Sociedad", "Villarreal", "Real Betis", "Eintracht Frankfurt", "VfB Stuttgart", "Bologna", "Lille", "Nice", "Lyon", "Fiorentina", "Sevilla", "Brentford", "Fulham", "Bournemouth", "West Ham United", "Everton", "Wolverhampton Wanderers", "Sunderland", "Leeds United", "Feyenoord", "PSV Eindhoven", "Ajax", "Galatasaray", "Fenerbahçe", "Al-Hilal", "Al-Nassr", "Flamengo", "Palmeiras", "Girona", "Como", "Inter Miami CF"];
for (const c of TIER2) CLUB_TIER.set(c, 2);
const TIER3 = ["Celtic", "Rangers", "Al-Ahli", "Al-Ittihad", "River Plate", "Boca Juniors", "Strasbourg", "TSG Hoffenheim", "SC Freiburg", "Mainz 05", "Borussia Mönchengladbach", "VfL Wolfsburg", "Werder Bremen", "Burnley", "Torino", "Udinese", "Genoa", "Sassuolo", "Cagliari", "Rennes", "Lens", "Toulouse", "Reims", "Le Havre", "Lorient", "Club Brugge", "Anderlecht", "Union Saint-Gilloise", "Genk", "Antwerp", "Braga", "Olympiacos", "Panathinaikos", "PAOK", "Red Bull Salzburg", "Copenhagen", "Midtjylland", "Nordsjælland", "Brøndby", "Zenit Saint Petersburg", "Krasnodar", "Al Ahly", "Pisa", "Cremonese", "Venezia", "Parma", "Coventry City", "Watford", "Norwich City", "Stoke City", "Hull City", "Derby County", "Swansea City", "Birmingham City", "Middlesbrough", "Southampton", "Leicester City", "Hamburger SV", "FC St. Pauli", "Holstein Kiel", "FC Augsburg", "Celta Vigo", "Rayo Vallecano", "Mallorca", "Osasuna", "Getafe", "Valencia", "Espanyol", "Oviedo", "Elche", "Dinamo Zagreb", "Hajduk Split", "Rijeka", "Red Star Belgrade", "Slavia Prague", "Viktoria Plzeň", "Sparta Prague", "Beşiktaş", "Trabzonspor", "Samsunspor", "İstanbul Başakşehir", "Kasımpaşa", "Çaykur Rizespor", "Pafos", "AEK Athens", "Maccabi Haifa", "Grêmio", "Botafogo", "Corinthians", "Santos", "São Paulo", "Internacional", "Atlético Mineiro", "Fluminense", "Vasco da Gama", "Athletico Paranaense", "Rosario Central", "Independiente", "Vélez Sarsfield", "Estudiantes", "Huracán", "Los Angeles FC", "Columbus Crew", "FC Cincinnati", "Seattle Sounders FC", "América", "Guadalajara", "Cruz Azul", "UANL", "Monterrey", "Toluca", "UNAM", "Pachuca", "Al-Sadd", "Al-Duhail", "Al Ain", "Al-Qadsiah", "Persepolis", "Esteghlal", "Mamelodi Sundowns", "Orlando Pirates", "Pyramids", "Zamalek", "Young Boys", "Basel", "Bodø/Glimt", "FC Tokyo", "Kashima Antlers", "Jeonbuk Hyundai Motors", "Ulsan HD", "AZ", "Twente", "Lokomotiv Moscow", "Dynamo Moscow", "Sturm Graz", "AEL Limassol"];
for (const c of TIER3) if (!CLUB_TIER.has(c)) CLUB_TIER.set(c, 3);
const TIER4 = ["Sint-Truiden", "NEC", "Utrecht", "Heerenveen", "Dender", "Mechelen", "Charleroi", "Standard Liège", "Kifisia", "Wolfsberger AC", "LASK", "Austria Wien", "Rapid Wien", "Malmö FF", "AIK", "Mjällby AIF", "Sanfrecce Hiroshima", "Toronto FC", "Vancouver Whitecaps FC", "Chicago Fire FC", "New York City FC", "New England Revolution", "Orlando City SC", "Charlotte FC", "Minnesota United FC", "Austin FC", "Real Salt Lake", "FC Dallas", "Colorado Rapids", "San Diego FC", "Atlas", "Pumas", "Santos Laguna", "Tijuana", "León", "Querétaro", "Al-Rayyan", "Al-Wakrah", "Al-Hussein", "Al-Faisaly", "Tractor", "Sepahan", "RS Berkane", "AS FAR", "Wydad AC", "Raja CA", "Espérance de Tunis", "Étoile du Sahel", "CS Sfaxien", "Kaizer Chiefs", "SuperSport United", "Sekhukhune United", "Stellenbosch", "Auckland FC", "Wellington Phoenix", "Melbourne City", "Sydney FC", "Macarthur FC", "PAOK B"];
for (const c of TIER4) if (!CLUB_TIER.has(c)) CLUB_TIER.set(c, 4);
const TIER_PTS = { 1: 16, 2: 12, 3: 8, 4: 5, 5: 2, 6: 0 };

// ------------------------------------------------------------ nation priors
const NATION = {
  "Spain":          { base: 10,  code: "ESP", flag: "🇪🇸", kit: ["#c8102e", "#ffc400"], pat: "solid" },
  "France":         { base: 10,  code: "FRA", flag: "🇫🇷", kit: ["#1e2a4a", "#ffffff"], pat: "solid" },
  "Argentina":      { base: 10,  code: "ARG", flag: "🇦🇷", kit: ["#74acdf", "#ffffff"], pat: "stripes" },
  "England":        { base: 9.5, code: "ENG", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", kit: ["#ffffff", "#1e2a4a"], pat: "solid" },
  "Brazil":         { base: 9.5, code: "BRA", flag: "🇧🇷", kit: ["#ffdc02", "#19ae47"], pat: "solid" },
  "Portugal":       { base: 9.5, code: "POR", flag: "🇵🇹", kit: ["#a4161a", "#1b5e20"], pat: "solid" },
  "Germany":        { base: 9,   code: "GER", flag: "🇩🇪", kit: ["#ffffff", "#000000"], pat: "solid" },
  "Netherlands":    { base: 9,   code: "NED", flag: "🇳🇱", kit: ["#ff7f00", "#21468b"], pat: "solid" },
  "Belgium":        { base: 8.5, code: "BEL", flag: "🇧🇪", kit: ["#d2232a", "#000000"], pat: "solid" },
  "Morocco":        { base: 8.5, code: "MAR", flag: "🇲🇦", kit: ["#b71c1c", "#1b5e20"], pat: "solid" },
  "Croatia":        { base: 8,   code: "CRO", flag: "🇭🇷", kit: ["#ffffff", "#d32f2f"], pat: "check" },
  "Uruguay":        { base: 8,   code: "URU", flag: "🇺🇾", kit: ["#5c9ad2", "#000000"], pat: "solid" },
  "Colombia":       { base: 8,   code: "COL", flag: "🇨🇴", kit: ["#ffe000", "#003893"], pat: "solid" },
  "Norway":         { base: 8,   code: "NOR", flag: "🇳🇴", kit: ["#d2232a", "#003087"], pat: "solid" },
  "Japan":          { base: 8,   code: "JPN", flag: "🇯🇵", kit: ["#1c2f6b", "#ffffff"], pat: "solid" },
  "Turkey":         { base: 8,   code: "TUR", flag: "🇹🇷", kit: ["#e30a17", "#ffffff"], pat: "solid" },
  "Switzerland":    { base: 7.5, code: "SUI", flag: "🇨🇭", kit: ["#d52b1e", "#ffffff"], pat: "solid" },
  "Senegal":        { base: 7.5, code: "SEN", flag: "🇸🇳", kit: ["#ffffff", "#00853f"], pat: "solid" },
  "Sweden":         { base: 7.5, code: "SWE", flag: "🇸🇪", kit: ["#ffe000", "#005293"], pat: "solid" },
  "Mexico":         { base: 7.5, code: "MEX", flag: "🇲🇽", kit: ["#006847", "#ffffff"], pat: "solid" },
  "United States":  { base: 7.5, code: "USA", flag: "🇺🇸", kit: ["#ffffff", "#bf0d3e"], pat: "hoop" },
  "Ecuador":        { base: 7.5, code: "ECU", flag: "🇪🇨", kit: ["#ffe000", "#03388e"], pat: "solid" },
  "Austria":        { base: 7.5, code: "AUT", flag: "🇦🇹", kit: ["#ed2939", "#ffffff"], pat: "solid" },
  "South Korea":    { base: 7,   code: "KOR", flag: "🇰🇷", kit: ["#e63946", "#1d3557"], pat: "solid" },
  "Scotland":       { base: 7,   code: "SCO", flag: "🏴󠁧󠁢󠁳󠁣󠁴󠁿", kit: ["#1a2a5e", "#ffffff"], pat: "solid" },
  "Egypt":          { base: 7,   code: "EGY", flag: "🇪🇬", kit: ["#ce1126", "#ffffff"], pat: "solid" },
  "Algeria":        { base: 7,   code: "ALG", flag: "🇩🇿", kit: ["#ffffff", "#006233"], pat: "solid" },
  "Ivory Coast":    { base: 7,   code: "CIV", flag: "🇨🇮", kit: ["#ff8200", "#ffffff"], pat: "solid" },
  "Ghana":          { base: 7,   code: "GHA", flag: "🇬🇭", kit: ["#ffffff", "#ce1126"], pat: "solid" },
  "Czech Republic": { base: 6.5, code: "CZE", flag: "🇨🇿", kit: ["#d7141a", "#11457e"], pat: "solid" },
  "Bosnia and Herzegovina": { base: 6.5, code: "BIH", flag: "🇧🇦", kit: ["#002f6c", "#fecb00"], pat: "solid" },
  "Australia":      { base: 6.5, code: "AUS", flag: "🇦🇺", kit: ["#ffcd00", "#00843d"], pat: "solid" },
  "Canada":         { base: 6.5, code: "CAN", flag: "🇨🇦", kit: ["#d52b1e", "#ffffff"], pat: "solid" },
  "Paraguay":       { base: 6.5, code: "PAR", flag: "🇵🇾", kit: ["#d52b1e", "#ffffff"], pat: "stripes" },
  "Tunisia":        { base: 6,   code: "TUN", flag: "🇹🇳", kit: ["#e70013", "#ffffff"], pat: "solid" },
  "Iran":           { base: 6,   code: "IRN", flag: "🇮🇷", kit: ["#ffffff", "#da0000"], pat: "solid" },
  "DR Congo":       { base: 6,   code: "COD", flag: "🇨🇩", kit: ["#007fff", "#f7d618"], pat: "solid" },
  "Saudi Arabia":   { base: 5.5, code: "KSA", flag: "🇸🇦", kit: ["#ffffff", "#006c35"], pat: "solid" },
  "Uzbekistan":     { base: 5.5, code: "UZB", flag: "🇺🇿", kit: ["#ffffff", "#0099b5"], pat: "solid" },
  "Panama":         { base: 5.5, code: "PAN", flag: "🇵🇦", kit: ["#d21034", "#005293"], pat: "solid" },
  "South Africa":   { base: 5.5, code: "RSA", flag: "🇿🇦", kit: ["#ffb612", "#007a4d"], pat: "solid" },
  "Qatar":          { base: 5,   code: "QAT", flag: "🇶🇦", kit: ["#8a1538", "#ffffff"], pat: "solid" },
  "Jordan":         { base: 5,   code: "JOR", flag: "🇯🇴", kit: ["#ffffff", "#ce1126"], pat: "solid" },
  "Iraq":           { base: 5,   code: "IRQ", flag: "🇮🇶", kit: ["#007a3d", "#ffffff"], pat: "solid" },
  "Cape Verde":     { base: 5,   code: "CPV", flag: "🇨🇻", kit: ["#003893", "#cf2027"], pat: "solid" },
  "New Zealand":    { base: 5,   code: "NZL", flag: "🇳🇿", kit: ["#ffffff", "#000000"], pat: "solid" },
  "Haiti":          { base: 4.5, code: "HAI", flag: "🇭🇹", kit: ["#00209f", "#d21034"], pat: "solid" },
  "Curaçao":        { base: 4.5, code: "CUW", flag: "🇨🇼", kit: ["#002b7f", "#f9e814"], pat: "solid" }
};

// --------------------------------------------------------- curated overalls
// Keyed "Nation|Name" exactly as parsed from Wikipedia. o = overall, p = pace
// override. Misses are reported, never fatal (heuristic takes over).
const CUR = {
  "Argentina|Lionel Messi": { o: 88, p: 72 }, "Argentina|Julián Alvarez": { o: 91 }, "Argentina|Lautaro Martínez": { o: 90 },
  "Argentina|Emiliano Martínez": { o: 89 }, "Argentina|Enzo Fernández": { o: 89 }, "Argentina|Alexis Mac Allister": { o: 89 },
  "Argentina|Cristian Romero": { o: 88 }, "Argentina|Rodrigo De Paul": { o: 86 }, "Argentina|Thiago Almada": { o: 86 },
  "Argentina|Nico Paz": { o: 86 }, "Argentina|Lisandro Martínez": { o: 86 }, "Argentina|Nahuel Molina": { o: 84 },
  "Argentina|Nicolás Otamendi": { o: 84, p: 58 }, "Argentina|Nicolás Tagliafico": { o: 83 }, "Argentina|Giovani Lo Celso": { o: 84 },
  "Argentina|Leandro Paredes": { o: 84 }, "Argentina|Exequiel Palacios": { o: 85 }, "Argentina|Nicolás González": { o: 84 },
  "Argentina|Gerónimo Rulli": { o: 84 }, "Argentina|Juan Musso": { o: 82 }, "Argentina|Giuliano Simeone": { o: 83, p: 90 },
  "France|Kylian Mbappé": { o: 95, p: 97 }, "France|Ousmane Dembélé": { o: 93, p: 93 }, "France|Michael Olise": { o: 89 },
  "France|Mike Maignan": { o: 89 }, "France|William Saliba": { o: 91 }, "France|Désiré Doué": { o: 88 },
  "France|Aurélien Tchouaméni": { o: 87 }, "France|Marcus Thuram": { o: 87, p: 90 }, "France|Bradley Barcola": { o: 86, p: 93 },
  "France|Jules Koundé": { o: 89 }, "France|Dayot Upamecano": { o: 87 }, "France|Ibrahima Konaté": { o: 87 },
  "France|Théo Hernandez": { o: 86, p: 91 }, "France|Adrien Rabiot": { o: 85 }, "France|Manu Koné": { o: 86 },
  "France|N'Golo Kanté": { o: 84 }, "France|Warren Zaïre-Emery": { o: 86 }, "France|Rayan Cherki": { o: 85 },
  "France|Jean-Philippe Mateta": { o: 84 }, "France|Lucas Hernandez": { o: 83 }, "France|Malo Gusto": { o: 83 },
  "France|Lucas Digne": { o: 82 }, "France|Maghnes Akliouche": { o: 84 }, "France|Brice Samba": { o: 83 }, "France|Maxence Lacroix": { o: 84 },
  "Spain|Lamine Yamal": { o: 94, p: 90 }, "Spain|Pedri": { o: 91 }, "Spain|Rodri": { o: 91 },
  "Spain|Nico Williams": { o: 89, p: 94 }, "Spain|Dani Olmo": { o: 88 }, "Spain|Martín Zubimendi": { o: 88 },
  "Spain|David Raya": { o: 88 }, "Spain|Unai Simón": { o: 87 }, "Spain|Joan Garcia": { o: 86 },
  "Spain|Mikel Oyarzabal": { o: 87 }, "Spain|Fabián Ruiz": { o: 87 }, "Spain|Mikel Merino": { o: 86 },
  "Spain|Gavi": { o: 86 }, "Spain|Álex Baena": { o: 85 }, "Spain|Ferran Torres": { o: 85 },
  "Spain|Pau Cubarsí": { o: 89 }, "Spain|Marc Cucurella": { o: 86 }, "Spain|Pedro Porro": { o: 85 },
  "Spain|Álex Grimaldo": { o: 86 }, "Spain|Aymeric Laporte": { o: 84 }, "Spain|Eric García": { o: 84 },
  "Spain|Marcos Llorente": { o: 84, p: 88 }, "Spain|Yéremy Pino": { o: 83 },
  "England|Harry Kane": { o: 92 }, "England|Jude Bellingham": { o: 92 }, "England|Bukayo Saka": { o: 90, p: 91 },
  "England|Declan Rice": { o: 89 }, "England|Marc Guéhi": { o: 87 }, "England|Jordan Pickford": { o: 86 },
  "England|Marcus Rashford": { o: 86, p: 90 }, "England|Eberechi Eze": { o: 86 }, "England|Anthony Gordon": { o: 85, p: 91 },
  "England|John Stones": { o: 85 }, "England|Reece James": { o: 85 }, "England|Morgan Rogers": { o: 85 },
  "England|Ollie Watkins": { o: 84 }, "England|Noni Madueke": { o: 84, p: 90 }, "England|Kobbie Mainoo": { o: 84 },
  "England|Ezri Konsa": { o: 84 }, "England|Elliot Anderson": { o: 84 }, "England|Tino Livramento": { o: 84, p: 89 },
  "England|Ivan Toney": { o: 83 }, "England|Nico O'Reilly": { o: 83 }, "England|Jordan Henderson": { o: 80 },
  "Brazil|Vinícius Júnior": { o: 92, p: 95 }, "Brazil|Raphinha": { o: 91 }, "Brazil|Alisson": { o: 90 },
  "Brazil|Bruno Guimarães": { o: 88 }, "Brazil|Marquinhos": { o: 88 }, "Brazil|Gabriel Magalhães": { o: 89 },
  "Brazil|Matheus Cunha": { o: 87 }, "Brazil|Ederson Moraes": { o: 87 }, "Brazil|Gabriel Martinelli": { o: 86, p: 92 },
  "Brazil|Bremer": { o: 86 }, "Brazil|Neymar": { o: 85 }, "Brazil|Casemiro": { o: 85 },
  "Brazil|Lucas Paquetá": { o: 85 }, "Brazil|Endrick": { o: 84, p: 89 }, "Brazil|Éderson Silva": { o: 84 },
  "Brazil|Fabinho": { o: 82 }, "Brazil|Luiz Henrique": { o: 83, p: 89 }, "Brazil|Igor Thiago": { o: 82 },
  "Brazil|Danilo Luiz": { o: 80 }, "Brazil|Alex Sandro": { o: 80 }, "Brazil|Weverton": { o: 80 },
  "Portugal|Cristiano Ronaldo": { o: 84, p: 74 }, "Portugal|Vitinha": { o: 90 }, "Portugal|Bruno Fernandes": { o: 89 },
  "Portugal|João Neves": { o: 89 }, "Portugal|Rúben Dias": { o: 89 }, "Portugal|Nuno Mendes": { o: 90, p: 92 },
  "Portugal|Bernardo Silva": { o: 88 }, "Portugal|Rafael Leão": { o: 88, p: 93 }, "Portugal|Diogo Costa": { o: 88 },
  "Portugal|Pedro Neto": { o: 85, p: 91 }, "Portugal|Gonçalo Ramos": { o: 85 }, "Portugal|Francisco Conceição": { o: 85, p: 90 },
  "Portugal|João Cancelo": { o: 85 }, "Portugal|Rúben Neves": { o: 85 }, "Portugal|João Félix": { o: 84 },
  "Portugal|Diogo Dalot": { o: 84 }, "Portugal|Gonçalo Inácio": { o: 84 }, "Portugal|Matheus Nunes": { o: 84 },
  "Germany|Jamal Musiala": { o: 90 }, "Germany|Florian Wirtz": { o: 90 }, "Germany|Joshua Kimmich": { o: 89 },
  "Germany|Antonio Rüdiger": { o: 88 }, "Germany|Kai Havertz": { o: 87 }, "Germany|Jonathan Tah": { o: 86 },
  "Germany|Nico Schlotterbeck": { o: 86 }, "Germany|Aleksandar Pavlović": { o: 86 }, "Germany|Manuel Neuer": { o: 85 },
  "Germany|Leroy Sané": { o: 85, p: 90 }, "Germany|Leon Goretzka": { o: 84 }, "Germany|Nick Woltemade": { o: 84 },
  "Germany|Angelo Stiller": { o: 84 }, "Germany|David Raum": { o: 83 }, "Germany|Maximilian Beier": { o: 82, p: 89 },
  "Germany|Deniz Undav": { o: 82 }, "Germany|Waldemar Anton": { o: 82 }, "Germany|Malick Thiaw": { o: 82 },
  "Netherlands|Virgil van Dijk": { o: 90 }, "Netherlands|Frenkie de Jong": { o: 88 }, "Netherlands|Cody Gakpo": { o: 88 },
  "Netherlands|Tijjani Reijnders": { o: 88 }, "Netherlands|Ryan Gravenberch": { o: 88 }, "Netherlands|Micky van de Ven": { o: 87, p: 93 },
  "Netherlands|Denzel Dumfries": { o: 86 }, "Netherlands|Bart Verbruggen": { o: 86 }, "Netherlands|Nathan Aké": { o: 85 },
  "Netherlands|Memphis Depay": { o: 85 }, "Netherlands|Justin Kluivert": { o: 84 }, "Netherlands|Jorrel Hato": { o: 84 },
  "Netherlands|Donyell Malen": { o: 83, p: 89 }, "Netherlands|Noa Lang": { o: 83 }, "Netherlands|Teun Koopmeiners": { o: 83 },
  "Netherlands|Crysencio Summerville": { o: 83, p: 90 }, "Netherlands|Wout Weghorst": { o: 81 }, "Netherlands|Brian Brobbey": { o: 81 },
  "Belgium|Thibaut Courtois": { o: 92 }, "Belgium|Kevin De Bruyne": { o: 88 }, "Belgium|Jérémy Doku": { o: 88, p: 95 },
  "Belgium|Romelu Lukaku": { o: 86 }, "Belgium|Youri Tielemans": { o: 86 }, "Belgium|Charles De Ketelaere": { o: 86 },
  "Belgium|Leandro Trossard": { o: 85 }, "Belgium|Amadou Onana": { o: 85 }, "Belgium|Alexis Saelemaekers": { o: 83 },
  "Belgium|Dodi Lukébakio": { o: 82, p: 88 }, "Belgium|Zeno Debast": { o: 82 }, "Belgium|Arthur Theate": { o: 82 },
  "Belgium|Maxim De Cuyper": { o: 82 }, "Belgium|Timothy Castagne": { o: 82 }, "Belgium|Hans Vanaken": { o: 81 },
  "Croatia|Joško Gvardiol": { o: 90 }, "Croatia|Mateo Kovačić": { o: 86 }, "Croatia|Luka Modrić": { o: 85, p: 62 },
  "Croatia|Dominik Livaković": { o: 85 }, "Croatia|Petar Sučić": { o: 84 }, "Croatia|Andrej Kramarić": { o: 83 },
  "Croatia|Martin Baturina": { o: 83 }, "Croatia|Nikola Vlašić": { o: 83 }, "Croatia|Mario Pašalić": { o: 83 },
  "Croatia|Josip Stanišić": { o: 83 }, "Croatia|Josip Šutalo": { o: 82 }, "Croatia|Luka Sučić": { o: 82 },
  "Morocco|Achraf Hakimi": { o: 92, p: 94 }, "Morocco|Yassine Bounou": { o: 88 }, "Morocco|Brahim Díaz": { o: 86 },
  "Morocco|Noussair Mazraoui": { o: 85 }, "Morocco|Bilal El Khannouss": { o: 85 }, "Morocco|Nayef Aguerd": { o: 84 },
  "Morocco|Sofyan Amrabat": { o: 84 }, "Morocco|Azzedine Ounahi": { o: 83 }, "Morocco|Ismael Saibari": { o: 83 },
  "Morocco|Abde Ezzalzouli": { o: 83, p: 90 }, "Morocco|Chemsdine Talbi": { o: 82 }, "Morocco|Ayyoub Bouaddi": { o: 82 },
  "Morocco|Ayoub El Kaabi": { o: 81 }, "Morocco|Soufiane Rahimi": { o: 81 }, "Morocco|Neil El Aynaoui": { o: 81 },
  "Uruguay|Federico Valverde": { o: 91 }, "Uruguay|Ronald Araújo": { o: 88 }, "Uruguay|Rodrigo Bentancur": { o: 86 },
  "Uruguay|Darwin Núñez": { o: 86, p: 91 }, "Uruguay|Manuel Ugarte": { o: 85 }, "Uruguay|José Giménez": { o: 85 },
  "Uruguay|Giorgian de Arrascaeta": { o: 84 }, "Uruguay|Nicolás de la Cruz": { o: 83 }, "Uruguay|Mathías Olivera": { o: 83 },
  "Uruguay|Sergio Rochet": { o: 83 }, "Uruguay|Maximiliano Araújo": { o: 82, p: 89 }, "Uruguay|Facundo Pellistri": { o: 81, p: 88 },
  "Colombia|Luis Díaz": { o: 89, p: 92 }, "Colombia|Jhon Arias": { o: 85 }, "Colombia|Richard Ríos": { o: 85 },
  "Colombia|Daniel Muñoz": { o: 85 }, "Colombia|Jhon Lucumí": { o: 84 }, "Colombia|Davinson Sánchez": { o: 84 },
  "Colombia|James Rodríguez": { o: 83, p: 65 }, "Colombia|Jefferson Lerma": { o: 83 }, "Colombia|Cucho Hernández": { o: 83 },
  "Colombia|Luis Suárez": { o: 82 }, "Colombia|Kevin Castaño": { o: 81 }, "Colombia|Jorge Carrascal": { o: 81 },
  "Colombia|Yerry Mina": { o: 81, p: 55 }, "Colombia|Jhon Córdoba": { o: 81 }, "Colombia|David Ospina": { o: 79 },
  "Norway|Erling Haaland": { o: 93, p: 92 }, "Norway|Martin Ødegaard": { o: 89 }, "Norway|Alexander Sørloth": { o: 85 },
  "Norway|Antonio Nusa": { o: 85, p: 92 }, "Norway|Jørgen Strand Larsen": { o: 84 }, "Norway|Sander Berge": { o: 83 },
  "Norway|Oscar Bobb": { o: 83 }, "Norway|Kristoffer Ajer": { o: 82 }, "Norway|Julian Ryerson": { o: 82 },
  "Norway|Fredrik Aursnes": { o: 81 }, "Norway|Patrick Berg": { o: 81 }, "Norway|Kristian Thorstvedt": { o: 81 },
  "Norway|Leo Østigård": { o: 81 }, "Norway|Andreas Schjelderup": { o: 81 }, "Norway|Ørjan Nyland": { o: 80 },
  "Japan|Takefusa Kubo": { o: 87 }, "Japan|Zion Suzuki": { o: 84 }, "Japan|Wataru Endo": { o: 84 },
  "Japan|Ritsu Dōan": { o: 84 }, "Japan|Daizen Maeda": { o: 83, p: 94 }, "Japan|Kō Itakura": { o: 83 },
  "Japan|Daichi Kamada": { o: 83 }, "Japan|Ayase Ueda": { o: 83 }, "Japan|Junya Itō": { o: 83, p: 89 },
  "Japan|Takehiro Tomiyasu": { o: 83 }, "Japan|Hiroki Itō": { o: 83 }, "Japan|Ao Tanaka": { o: 82 },
  "Japan|Keito Nakamura": { o: 82 }, "Japan|Yukinari Sugawara": { o: 81 }, "Japan|Tsuyoshi Watanabe": { o: 81 },
  "South Korea|Kim Min-jae": { o: 87 }, "South Korea|Son Heung-min": { o: 86, p: 84 }, "South Korea|Lee Kang-in": { o: 86 },
  "South Korea|Hwang In-beom": { o: 84 }, "South Korea|Hwang Hee-chan": { o: 83, p: 88 }, "South Korea|Lee Jae-sung": { o: 81 },
  "South Korea|Cho Gue-sung": { o: 81 }, "South Korea|Jo Hyeon-woo": { o: 81 }, "South Korea|Oh Hyeon-gyu": { o: 80 },
  "South Korea|Kim Seung-gyu": { o: 80 },
  "Mexico|Edson Álvarez": { o: 85 }, "Mexico|Santiago Giménez": { o: 84 }, "Mexico|Gilberto Mora": { o: 82 },
  "Mexico|Raúl Jiménez": { o: 82 }, "Mexico|César Montes": { o: 81 }, "Mexico|Alexis Vega": { o: 81 },
  "Mexico|Johan Vásquez": { o: 80 }, "Mexico|Roberto Alvarado": { o: 80 }, "Mexico|Julián Quiñones": { o: 80 },
  "Mexico|Raúl Rangel": { o: 80 }, "Mexico|Orbelín Pineda": { o: 79 }, "Mexico|Luis Chávez": { o: 79 },
  "Mexico|Guillermo Ochoa": { o: 77 }, "Mexico|Luis Romo": { o: 79 }, "Mexico|César Huerta": { o: 79, p: 88 },
  "United States|Christian Pulisic": { o: 87, p: 88 }, "United States|Antonee Robinson": { o: 84, p: 90 },
  "United States|Tyler Adams": { o: 84 }, "United States|Folarin Balogun": { o: 84, p: 88 }, "United States|Malik Tillman": { o: 84 },
  "United States|Weston McKennie": { o: 83 }, "United States|Sergiño Dest": { o: 83 }, "United States|Ricardo Pepi": { o: 83 },
  "United States|Chris Richards": { o: 83 }, "United States|Timothy Weah": { o: 83, p: 91 }, "United States|Giovanni Reyna": { o: 82 },
  "United States|Brenden Aaronson": { o: 81 }, "United States|Matt Turner": { o: 81 }, "United States|Haji Wright": { o: 81 },
  "Switzerland|Gregor Kobel": { o: 88 }, "Switzerland|Manuel Akanji": { o: 87 }, "Switzerland|Granit Xhaka": { o: 86 },
  "Switzerland|Dan Ndoye": { o: 84, p: 90 }, "Switzerland|Breel Embolo": { o: 83 }, "Switzerland|Denis Zakaria": { o: 84 },
  "Switzerland|Ardon Jashari": { o: 84 }, "Switzerland|Nico Elvedi": { o: 82 }, "Switzerland|Remo Freuler": { o: 82 },
  "Switzerland|Noah Okafor": { o: 82, p: 89 }, "Switzerland|Rubén Vargas": { o: 82 }, "Switzerland|Johan Manzambi": { o: 82 },
  "Switzerland|Ricardo Rodriguez": { o: 80 }, "Switzerland|Zeki Amdouni": { o: 81 }, "Switzerland|Djibril Sow": { o: 81 },
  "Sweden|Alexander Isak": { o: 90, p: 90 }, "Sweden|Viktor Gyökeres": { o: 89, p: 89 }, "Sweden|Anthony Elanga": { o: 84, p: 94 },
  "Sweden|Lucas Bergvall": { o: 84 }, "Sweden|Isak Hien": { o: 83 }, "Sweden|Yasin Ayari": { o: 83 },
  "Sweden|Mattias Svanberg": { o: 82 }, "Sweden|Victor Lindelöf": { o: 81 }, "Sweden|Benjamin Nygren": { o: 80 },
  "Sweden|Gabriel Gudmundsson": { o: 80 }, "Sweden|Daniel Svensson": { o: 80 }, "Sweden|Viktor Johansson": { o: 79 },
  "Turkey|Hakan Çalhanoğlu": { o: 88 }, "Turkey|Arda Güler": { o: 88 }, "Turkey|Kenan Yıldız": { o: 88 },
  "Turkey|Orkun Kökçü": { o: 85 }, "Turkey|Kerem Aktürkoğlu": { o: 84 }, "Turkey|Ferdi Kadıoğlu": { o: 84 },
  "Turkey|Merih Demiral": { o: 84 }, "Turkey|Barış Alper Yılmaz": { o: 82, p: 89 }, "Turkey|Uğurcan Çakır": { o: 82 },
  "Turkey|Çağlar Söyüncü": { o: 82 }, "Turkey|Can Uzun": { o: 82 }, "Turkey|Zeki Çelik": { o: 81 },
  "Turkey|Salih Özcan": { o: 80 }, "Turkey|Ozan Kabak": { o: 80 }, "Turkey|Altay Bayındır": { o: 80 },
  "Senegal|Sadio Mané": { o: 86, p: 88 }, "Senegal|Nicolas Jackson": { o: 86, p: 90 }, "Senegal|Iliman Ndiaye": { o: 85 },
  "Senegal|Pape Matar Sarr": { o: 85 }, "Senegal|Ismaïla Sarr": { o: 84, p: 92 }, "Senegal|Édouard Mendy": { o: 84 },
  "Senegal|Kalidou Koulibaly": { o: 84 }, "Senegal|Lamine Camara": { o: 84 }, "Senegal|Habib Diarra": { o: 83 },
  "Senegal|Assane Diao": { o: 82, p: 92 }, "Senegal|Moussa Niakhaté": { o: 82 }, "Senegal|Idrissa Gueye": { o: 81 },
  "Senegal|Krépin Diatta": { o: 81 }, "Senegal|El Hadji Malick Diouf": { o: 81 }, "Senegal|Ismail Jakobs": { o: 80 },
  "Ecuador|Moisés Caicedo": { o: 90 }, "Ecuador|Willian Pacho": { o: 87 }, "Ecuador|Piero Hincapié": { o: 86 },
  "Ecuador|Pervis Estupiñán": { o: 84 }, "Ecuador|Kendry Páez": { o: 84 }, "Ecuador|Gonzalo Plata": { o: 83, p: 89 },
  "Ecuador|Joel Ordóñez": { o: 83 }, "Ecuador|Alan Franco": { o: 80 }, "Ecuador|Enner Valencia": { o: 80 },
  "Ecuador|Ángelo Preciado": { o: 80 }, "Ecuador|Kevin Rodríguez": { o: 79 }, "Ecuador|Hernán Galíndez": { o: 78 },
  "Egypt|Mohamed Salah": { o: 91, p: 89 }, "Egypt|Omar Marmoush": { o: 87, p: 89 }, "Egypt|Emam Ashour": { o: 81 },
  "Egypt|Mohamed Abdelmonem": { o: 81 }, "Egypt|Zizo": { o: 80 }, "Egypt|Ibrahim Adel": { o: 80 },
  "Egypt|Trézéguet": { o: 79 }, "Egypt|Mohamed El Shenawy": { o: 79 },
  "Austria|David Alaba": { o: 84 }, "Austria|Konrad Laimer": { o: 84 }, "Austria|Marcel Sabitzer": { o: 84 },
  "Austria|Xaver Schlager": { o: 84 }, "Austria|Nicolas Seiwald": { o: 84 }, "Austria|Kevin Danso": { o: 84 },
  "Austria|Marko Arnautović": { o: 82 }, "Austria|Paul Wanner": { o: 81 }, "Austria|Carney Chukwuemeka": { o: 81 },
  "Austria|Patrick Wimmer": { o: 80 }, "Austria|Romano Schmid": { o: 80 }, "Austria|Philipp Lienhart": { o: 80 },
  "Austria|Stefan Posch": { o: 80 }, "Austria|Alexander Schlager": { o: 79 },
  "Canada|Alphonso Davies": { o: 87, p: 95 }, "Canada|Jonathan David": { o: 86 }, "Canada|Stephen Eustáquio": { o: 82 },
  "Canada|Moïse Bombito": { o: 82 }, "Canada|Tajon Buchanan": { o: 81, p: 91 }, "Canada|Ismaël Koné": { o: 81 },
  "Canada|Alistair Johnston": { o: 81 }, "Canada|Cyle Larin": { o: 80 }, "Canada|Tani Oluwaseyi": { o: 80 },
  "Canada|Promise David": { o: 80 }, "Canada|Derek Cornelius": { o: 79 }, "Canada|Dayne St. Clair": { o: 80 },
  "Canada|Jonathan Osorio": { o: 78 }, "Canada|Maxime Crépeau": { o: 78 },
  "Scotland|Scott McTominay": { o: 86 }, "Scotland|Andy Robertson": { o: 84 }, "Scotland|John McGinn": { o: 82 },
  "Scotland|Aaron Hickey": { o: 80 }, "Scotland|Ben Gannon-Doak": { o: 80, p: 91 },
  "Scotland|Ché Adams": { o: 79 }, "Scotland|Angus Gunn": { o: 78 }, "Scotland|Craig Gordon": { o: 76 },
  "Scotland|Kieran Tierney": { o: 80 }, "Scotland|Lewis Ferguson": { o: 81 }, "Scotland|Lyndon Dykes": { o: 77 },
  "Czech Republic|Patrik Schick": { o: 85 }, "Czech Republic|Tomáš Souček": { o: 81 }, "Czech Republic|Matěj Kovář": { o: 80 },
  "Czech Republic|Adam Hložek": { o: 80 }, "Czech Republic|Vladimír Coufal": { o: 79 }, "Czech Republic|Lukáš Provod": { o: 79 },
  "Czech Republic|Pavel Šulc": { o: 80 }, "Czech Republic|Mojmír Chytil": { o: 78 },
  "Bosnia and Herzegovina|Edin Džeko": { o: 80, p: 58 }, "Bosnia and Herzegovina|Ermedin Demirović": { o: 82 },
  "Bosnia and Herzegovina|Benjamin Tahirović": { o: 79 }, "Bosnia and Herzegovina|Amar Dedić": { o: 80 },
  "Bosnia and Herzegovina|Ivan Bašić": { o: 77 }, "Bosnia and Herzegovina|Esmir Bajraktarević": { o: 78 },
  "Iran|Mehdi Taremi": { o: 83 }, "Iran|Saman Ghoddos": { o: 77 },
  "Iran|Alireza Jahanbakhsh": { o: 77 }, "Iran|Alireza Beiranvand": { o: 78 }, "Iran|Saeid Ezatolahi": { o: 77 },
  "Iran|Mohammad Mohebi": { o: 77 },
  "Algeria|Riyad Mahrez": { o: 84 }, "Algeria|Mohamed Amoura": { o: 84, p: 92 }, "Algeria|Amine Gouiri": { o: 83 },
  "Algeria|Houssem Aouar": { o: 82 }, "Algeria|Ramy Bensebaini": { o: 82 },
  "Algeria|Farès Chaïbi": { o: 81 }, "Algeria|Rayan Aït-Nouri": { o: 84 },   "Tunisia|Hannibal Mejbri": { o: 79 },   "Tunisia|Elias Achouri": { o: 78 }, "Tunisia|Hazem Mastouri": { o: 77 },
  "Ivory Coast|Amad Diallo": { o: 85, p: 89 }, "Ivory Coast|Evan Ndicka": { o: 83 }, "Ivory Coast|Franck Kessié": { o: 82 },
  "Ivory Coast|Simon Adingra": { o: 82, p: 92 }, "Ivory Coast|Ibrahim Sangaré": { o: 80 }, "Ivory Coast|Seko Fofana": { o: 80 },
  "Ivory Coast|Yahia Fofana": { o: 79 }, "Ivory Coast|Oumar Diakité": { o: 79 },
    "Ghana|Antoine Semenyo": { o: 86, p: 89 }, "Ghana|Thomas Partey": { o: 82 },
  "Ghana|Iñaki Williams": { o: 82, p: 91 }, "Ghana|Ernest Nuamah": { o: 80, p: 90 },
  "Ghana|Jordan Ayew": { o: 78 }, "Ghana|Alidu Seidu": { o: 79 },
  "Ghana|Abdul Fatawu": { o: 80 }, "Ghana|Kamaldeen Sulemana": { o: 81, p: 93 },
  "Saudi Arabia|Salem Al-Dawsari": { o: 80 }, "Saudi Arabia|Firas Al-Buraikan": { o: 77 }, "Saudi Arabia|Mohamed Kanno": { o: 76 },
  "Saudi Arabia|Mohammed Al-Owais": { o: 76 }, "Saudi Arabia|Musab Al-Juwayr": { o: 77 },
  "Qatar|Akram Afif": { o: 80 }, "Qatar|Almoez Ali": { o: 77 },
  "Uzbekistan|Abdukodir Khusanov": { o: 84 }, "Uzbekistan|Abbosbek Fayzullaev": { o: 80 }, "Uzbekistan|Eldor Shomurodov": { o: 78 },
    "Jordan|Musa Al-Taamari": { o: 80 }, "Jordan|Ali Olwan": { o: 76 },
  "Iraq|Ali Jasim": { o: 77 }, "Iraq|Aymen Hussein": { o: 76 }, "Iraq|Youssef Amyn": { o: 76 },
  "DR Congo|Yoane Wissa": { o: 84 }, "DR Congo|Chancel Mbemba": { o: 80 }, "DR Congo|Cédric Bakambu": { o: 78 },
  "DR Congo|Simon Banza": { o: 80 }, "DR Congo|Théo Bongonda": { o: 78 }, "DR Congo|Axel Tuanzebe": { o: 77 },
  "DR Congo|Ngal'ayel Mukau": { o: 79 },
  "Panama|Adalberto Carrasquilla": { o: 79 }, "Panama|Michael Amir Murillo": { o: 79 }, "Panama|José Fajardo": { o: 76 },
  "Haiti|Duckens Nazon": { o: 75 }, "Haiti|Danley Jean Jacques": { o: 77 }, "Haiti|Jean-Ricner Bellegarde": { o: 80 },
  "New Zealand|Chris Wood": { o: 83 }, "New Zealand|Liberato Cacace": { o: 78 }, "New Zealand|Marko Stamenić": { o: 77 },
  "New Zealand|Matthew Garbett": { o: 76 },
  "South Africa|Ronwen Williams": { o: 79 }, "South Africa|Lyle Foster": { o: 79 }, "South Africa|Teboho Mokoena": { o: 78 },
  "South Africa|Relebohile Mofokeng": { o: 78 },
  "Australia|Jackson Irvine": { o: 79 }, "Australia|Harry Souttar": { o: 79 }, "Australia|Mathew Ryan": { o: 78 },
    "Australia|Nestory Irankunda": { o: 78, p: 90 },
  "Paraguay|Miguel Almirón": { o: 81, p: 88 }, "Paraguay|Julio Enciso": { o: 81 }, "Paraguay|Gustavo Gómez": { o: 80 },
  "Paraguay|Antonio Sanabria": { o: 78 }, "Paraguay|Omar Alderete": { o: 79 }, "Paraguay|Diego Gómez": { o: 80 },
  "Curaçao|Tahith Chong": { o: 77 }, "Curaçao|Leandro Bacuna": { o: 75 }, "Curaçao|Jürgen Locadia": { o: 75 }
};

// ------------------------------------------------------------- deterministic
const hash = (s) => { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const jit = (key, range) => ((hash(key) % 1000) / 1000 - 0.5) * 2 * range;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));

function overall(nation, p) {
  const cur = CUR[`${nation}|${p.name}`];
  if (cur) return cur.o;
  const tier = CLUB_TIER.get(p.club) ?? 5;
  const base = NATION[nation].base;
  let o = 47 + base * 1.6 + TIER_PTS[tier];
  o += Math.min(12, Math.sqrt(p.caps) * 1.35);            // experience
  const peak = p.pos === "GK" ? 31 : 27;
  o -= Math.abs(p.age - peak) * (p.age > peak ? 0.55 : 0.35);
  if (p.pos === "FW" || p.pos === "MF") o += Math.min(5, p.goals * 0.12);
  return clamp(o, 52, 84);
}

function stats(nation, p, ovr) {
  const k = (s) => `${nation}|${p.name}|${s}`;
  const J = (s, r = 3) => jit(k(s), r);
  let sho, pas, def, ctl, pac, gk;
  const pacBase = { GK: 52, DF: 68, MF: 70, FW: 75 }[p.pos];
  pac = pacBase + (ovr - 70) * 0.55 - Math.max(0, p.age - 29) * 1.4 + J("pac", 4);
  if (p.pos === "GK") { gk = ovr; sho = ovr - 30; pas = ovr - 9; def = ovr - 15; ctl = ovr - 14; }
  else if (p.pos === "DF") { gk = 20; def = ovr + 2; pas = ovr - 5; ctl = ovr - 6; sho = ovr - 14; }
  else if (p.pos === "MF") { gk = 16; pas = ovr + 2; ctl = ovr + 1; def = ovr - 8; sho = ovr - 6; }
  else { gk = 12; sho = ovr + 2; ctl = ovr; pas = ovr - 7; def = ovr - 20; }
  const cur = CUR[`${nation}|${p.name}`];
  if (cur?.p != null) pac = cur.p;
  return {
    sho: clamp(sho + J("sho"), 30, 99), pas: clamp(pas + J("pas"), 30, 99),
    def: clamp(def + J("def"), 30, 99), ctl: clamp(ctl + J("ctl"), 30, 99),
    pac: clamp(pac, 40, 97), gk: clamp(gk + (p.pos === "GK" ? 0 : J("gk", 2)), 8, 99)
  };
}

// --------------------------------------------------------------------- build
const misses = new Set(Object.keys(CUR));
const out = { generated: new Date().toISOString().slice(0, 10), nations: [] };

for (const n of raw) {
  const meta = NATION[n.nation];
  if (!meta) { console.error(`!! no nation meta for ${n.nation}`); continue; }
  const players = n.players.map((p) => {
    misses.delete(`${n.nation}|${p.name}`);
    const ovr = overall(n.nation, p);
    const s = stats(n.nation, p, ovr);
    return { name: p.name, pos: p.pos, club: p.club, age: p.age, caps: p.caps, num: p.num, ovr, ...s };
  });
  players.sort((a, b) => b.ovr - a.ovr);
  // draft list: top players with guaranteed position coverage
  const draft = new Set();
  const byPos = (pos, k) => players.filter((p) => p.pos === pos).slice(0, k).forEach((p) => draft.add(p.name));
  byPos("GK", 2); byPos("DF", 2); byPos("MF", 1); byPos("FW", 1);
  for (const p of players) { if (draft.size >= 10) break; draft.add(p.name); }
  const top7 = players.slice(0, 7).reduce((a, p) => a + p.ovr, 0) / 7;
  out.nations.push({
    name: n.nation, code: meta.code, flag: meta.flag, kit: meta.kit, pat: meta.pat,
    realGroup: n.group, rating: Math.round(top7 * 10) / 10,
    players: players.map((p) => ({ ...p, d: draft.has(p.name) ? 1 : 0 }))
  });
}

// pots by team rating (1..4, 12 each)
out.nations.sort((a, b) => b.rating - a.rating);
out.nations.forEach((n, i) => (n.pot = Math.floor(i / 12) + 1));

mkdirSync(new URL("../src/data/", import.meta.url).pathname, { recursive: true });
writeFileSync(new URL("../src/data/squads.json", import.meta.url).pathname, JSON.stringify(out));

console.log("== team ratings / pots ==");
for (const n of out.nations) console.log(`pot${n.pot}  ${n.rating.toFixed(1)}  ${n.name}`);
if (misses.size) {
  console.log(`\n== curated entries with no squad match (heuristic used instead): ${misses.size} ==`);
  for (const m of misses) console.log("  miss:", m);
}
const all = out.nations.flatMap((n) => n.players);
console.log(`\nplayers: ${all.length}, draftable: ${all.filter((p) => p.d).length}`);
console.log(`ovr range: ${Math.min(...all.map((p) => p.ovr))}..${Math.max(...all.map((p) => p.ovr))}`);
