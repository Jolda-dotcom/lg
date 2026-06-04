const playerInfoEl = document.getElementById('player-info');
const seasonInfoEl = document.getElementById('season-info');
const summaryInfoEl = document.getElementById('summary-info');
const careerLogEl = document.getElementById('career-log');
const transferOffersEl = document.getElementById('transfer-offers');
const nextSeasonBtn = document.getElementById('next-season-btn');
const declineOffersBtn = document.getElementById('decline-offers-btn');

function formatMoney(value) {
  return `€${value.toLocaleString('en-US')}`;
}

class Player {
  constructor(name, age, height, weight, position, initialRating) {
    this.name = name;
    this.age = age;
    this.height = height;
    this.weight = weight;
    this.position = position;
    this.rating = initialRating;
    this.potential = initialRating + 20 + Math.random() * 6;
    this.club = null;
    this.contractYearsLeft = 3;
    this.totalGoals = 0;
    this.goalsLastSeason = 0;
    this.injurySeasons = 0;
    this.retired = false;
    this.history = [];
  }

  get buildFactor() {
    const heightBonus = Math.max(0, (this.height - 180) * 0.015);
    const weightBonus = Math.max(0, (80 - this.weight) * 0.01);
    return 1 + heightBonus + weightBonus;
  }

  get value() {
    return Math.max(300000, Math.round(this.rating * 120000));
  }

  ageOneYear() {
    this.age += 1;
    if (this.contractYearsLeft > 0) {
      this.contractYearsLeft -= 1;
    }
  }

  train() {
    if (this.injurySeasons > 0) return 0;
    let change = 0;
    if (this.age <= 20) {
      change = 3 + Math.random() * 2;
    } else if (this.age <= 24) {
      change = 1.5 + Math.random() * 1.5;
    } else if (this.age <= 28) {
      change = 0.8 + Math.random() * 1.2;
    } else if (this.age <= 32) {
      change = -0.2 + Math.random() * 0.8;
    } else if (this.age <= 36) {
      change = -0.8 + Math.random() * 0.5;
    } else {
      change = -1.2 + Math.random() * 0.3;
    }
    if (this.age > 30) {
      change -= Math.random() * 0.5;
    }
    this.rating = Math.max(52, Math.min(96, this.rating + change));
    if (this.rating > this.potential) {
      this.rating = this.potential;
    }
    return Number(change.toFixed(1));
  }

  checkInjury() {
    if (this.injurySeasons > 0) {
      this.injurySeasons -= 1;
      return;
    }
    const baseChance = 0.05;
    const agePenalty = Math.max(0, (this.age - 26) * 0.015);
    const chance = baseChance + agePenalty;
    if (Math.random() < chance) {
      this.injurySeasons = Math.random() < 0.6 ? 1 : 2;
    }
  }

  get isInjured() {
    return this.injurySeasons > 0;
  }
}

class Club {
  constructor(name, country, level, budget, offense) {
    this.name = name;
    this.country = country;
    this.level = level;
    this.budget = budget;
    this.offense = offense;
    this.squad = [];
  }

  signPlayer(player, years) {
    if (!this.squad.includes(player)) {
      this.squad.push(player);
      player.club = this;
      player.contractYearsLeft = years;
    }
  }

  sellPlayer(player, fee) {
    const idx = this.squad.indexOf(player);
    if (idx !== -1) {
      this.squad.splice(idx, 1);
      player.club = null;
      this.budget += fee;
    }
  }

  playSeason(player) {
    if (player.isInjured) {
      const goals = Math.max(0, Math.round(2 + Math.random() * 3));
      player.goalsLastSeason = goals;
      player.totalGoals += goals;
      return {
        goals,
        expectedGoals: 0,
        satisfaction: 'Povrijeđen',
      };
    }
    const agePenalty = Math.max(0, (player.age - 28) * 0.035);
    const ratingFactor = Math.max(0, (player.rating - 60) * 0.5);
    const supportFactor = this.offense * 0.75;
    const randomFactor = Math.random() * 7;
    const rawGoals = 10 + ratingFactor + supportFactor + randomFactor;
    const actualGoals = Math.max(0, Math.min(45, Math.round(rawGoals * player.buildFactor * (1 - agePenalty))));
    const expectedGoals = Math.round(12 + this.offense * 1.2 + (player.rating - 64) * 0.25);
    player.goalsLastSeason = actualGoals;
    player.totalGoals += actualGoals;
    return {
      goals: actualGoals,
      expectedGoals,
      satisfaction: this.evaluateSatisfaction(actualGoals, expectedGoals),
    };
  }

  evaluateSatisfaction(goals, expectedGoals) {
    if (goals >= expectedGoals) return 'Zadovoljan';
    if (goals >= expectedGoals * 0.8) return 'Neutralan';
    return 'Nije zadovoljan';
  }
}

class TransferMarket {
  constructor(clubs) {
    this.clubs = clubs;
  }

  generateOffers(player) {
    const offers = [];
    const baseScore = Math.max(0, (player.goalsLastSeason - 10) * 0.08 + (player.rating - 65) * 0.05);
    const contractPressure = player.contractYearsLeft <= 1 ? 0.18 : 0;
    const agePenalty = player.age > 30 ? (player.age - 30) * 0.02 : 0;
    this.clubs.forEach((club) => {
      if (club === player.club) return;
      const levelDiff = club.level - player.club.level;
      const interest = Math.min(0.95, Math.max(0.05, 0.12 + baseScore + levelDiff * 0.1 - agePenalty + contractPressure));
      if (Math.random() < interest) {
        const price = Math.round(player.value * (0.65 + club.level * 0.12 + Math.random() * 0.24));
        const years = player.age <= 30 ? 4 : 2;
        offers.push({ club, price, years, interest: interest.toFixed(2) });
      }
    });
    return offers.sort((a, b) => b.price - a.price);
  }
}

class CareerGame {
  constructor() {
    this.player = new Player('Armin', 16, 186, 76, 'Napadač', 66);
    this.clubs = [
      new Club('FK Sarajevo', 'BiH', 1, 21000000, 7.1),
      new Club('HŠK Zrinjski', 'BiH', 1, 14000000, 6.8),
      new Club('GNK Dinamo Zagreb', 'HR', 2, 78000000, 8.2),
      new Club('RB Salzburg', 'AUT', 2, 94000000, 8.4),
      new Club('Borussia Dortmund', 'GER', 3, 240000000, 9.0),
      new Club('PSG', 'FRA', 4, 420000000, 9.4),
      new Club('FC Barcelona', 'ESP', 4, 430000000, 9.5),
    ];
    this.market = new TransferMarket(this.clubs);
    this.currentSeason = 2025;
    this.seasonsSinceReport = 0;
    this.awaitingTransfer = false;
    this.ended = false;
    this.player.club = this.clubs[0];
    this.clubs[0].signPlayer(this.player, 3);
    this.currentLog = [];
  }

  get statusText() {
    return this.ended ? 'Karijera završena' : this.awaitingTransfer ? 'Čekanje ponuda' : 'Igra se sezona';
  }

  initialize() {
    this.addLog(`Kreira se karijera napadača.
Igrač: ${this.player.name} | ${this.player.age} godina | ${this.player.height} cm | ${this.player.weight} kg | ${this.player.position}`);
    this.addLog(`Početni klub: ${this.player.club.name} (${this.player.club.country})
Rating: ${this.player.rating.toFixed(1)} | Potencijal: ${this.player.potential.toFixed(1)}
`);
    this.render();
  }

  addLog(text) {
    this.currentLog.push(text);
    careerLogEl.textContent = this.currentLog.join('\n');
  }

  render() {
    playerInfoEl.innerHTML = `
<div><strong>Klub:</strong> ${this.player.club.name}</div>
<div><strong>Rating:</strong> ${this.player.rating.toFixed(1)}</div>
<div><strong>Vrijednost:</strong> ${formatMoney(this.player.value)}</div>
<div><strong>Ugovor:</strong> ${this.player.contractYearsLeft} god</div>
<div><strong>Povreda:</strong> ${this.player.isInjured ? `da (${this.player.injurySeasons} sezone)` : 'ne'}</div>
<div><strong>Ukupno golova:</strong> ${this.player.totalGoals}</div>
`;
    seasonInfoEl.innerHTML = `
<div><strong>Sezona:</strong> ${this.currentSeason}/${this.currentSeason + 1}</div>
<div><strong>Godina:</strong> ${this.player.age}</div>
<div><strong>Status:</strong> ${this.statusText}</div>
<div><strong>Klub:</strong> ${this.player.club.name} (${this.player.club.level}. liga)</div>
`;
    summaryInfoEl.innerHTML = `
<div><strong>Pozicija:</strong> ${this.player.position}</div>
<div><strong>Visina:</strong> ${this.player.height} cm</div>
<div><strong>Težina:</strong> ${this.player.weight} kg</div>
<div><strong>Potencijal:</strong> ${this.player.potential.toFixed(1)}</div>
`; 
    nextSeasonBtn.disabled = this.ended || this.awaitingTransfer;
    declineOffersBtn.disabled = !this.awaitingTransfer || this.ended;
  }

  simulateSeason() {
    if (this.ended || this.awaitingTransfer) return;
    const club = this.player.club;
    this.addLog(`\n=== Sezona ${this.currentSeason}/${this.currentSeason + 1} ===`);
    if (this.player.isInjured) {
      this.addLog(`Igrač je povrijeđen, sezona će biti slabija.`);
    }
    const stats = club.playSeason(this.player);
    this.player.history.push({ season: `${this.currentSeason}/${this.currentSeason + 1}`, club: club.name, goals: stats.goals });
    this.addLog(`Golovi: ${stats.goals} | Očekivano: ${stats.expectedGoals || '—'} | Status: ${stats.satisfaction}`);
    this.seasonsSinceReport += 1;

    const offers = this.market.generateOffers(this.player);
    if (offers.length > 0) {
      this.awaitingTransfer = true;
      this.showOffers(offers);
      this.addLog('Dostupne su nove ponude. Izaberi transfer ili odbij.' );
    } else {
      this.addLog('Nema ozbiljnih ponuda ovog ljeta. Nastavljaš u istom klubu.');
      this.clearOffers();
      this.completeSeason();
    }
    this.updateSeasonEnd();
  }

  showOffers(offers) {
    transferOffersEl.innerHTML = '';
    offers.slice(0, 3).forEach((offer, index) => {
      const card = document.createElement('div');
      card.className = 'offer-card';
      card.innerHTML = `
        <h3>${offer.club.name} (${offer.club.country})</h3>
        <p><strong>Liga:</strong> ${offer.club.level}</p>
        <p><strong>Transfer:</strong> ${formatMoney(offer.price)}</p>
        <p><strong>Ugovor:</strong> ${offer.years} god</p>
        <p><strong>Interes:</strong> ${offer.interest}</p>
      `;
      const btn = document.createElement('button');
      btn.className = 'action-btn';
      btn.textContent = 'Prihvati ponudu';
      btn.addEventListener('click', () => this.acceptOffer(offers[index]));
      card.appendChild(btn);
      transferOffersEl.appendChild(card);
    });
  }

  clearOffers() {
    transferOffersEl.innerHTML = '<p>Nema ponuda za prikazivanje.</p>';
  }

  acceptOffer(offer) {
    if (this.ended || !this.awaitingTransfer) return;
    const currentClub = this.player.club;
    if (offer.club.budget >= offer.price) {
      currentClub.sellPlayer(this.player, offer.price);
      offer.club.signPlayer(this.player, offer.years);
      offer.club.budget -= offer.price;
      this.addLog(`TRANSFER: ${this.player.name} prešao u ${offer.club.name} za ${formatMoney(offer.price)}. Ugovor: ${offer.years} god.`);
    } else {
      this.addLog('Ponuda nije uspjela jer klub nema dovoljno budžeta.');
    }
    this.awaitingTransfer = false;
    this.clearOffers();
    this.completeSeason();
  }

  declineOffers() {
    if (this.ended || !this.awaitingTransfer) return;
    this.addLog('Odbio si trenutne ponude i ostao u istom klubu.');
    this.awaitingTransfer = false;
    this.clearOffers();
    this.completeSeason();
  }

  completeSeason() {
    this.player.checkInjury();
    const delta = this.player.train();
    const formattedDelta = delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);
    this.addLog(`Trening i napredak: rating ${this.player.rating.toFixed(1)} (${formattedDelta})`);
    this.player.ageOneYear();
    this.currentSeason += 1;
    if (this.seasonsSinceReport >= 2) {
      this.printBiannualReport();
      this.seasonsSinceReport = 0;
    }
    if (this.player.age > 41 || this.player.rating < 54 && this.player.age > 37) {
      this.endCareer();
    }
    this.render();
  }

  updateSeasonEnd() {
    this.render();
  }

  printBiannualReport() {
    this.addLog('\n--- Izvještaj nakon 2 godine ---');
    const lastTwo = this.player.history.slice(-2);
    lastTwo.forEach((row) => {
      this.addLog(`${row.season}: ${row.club} | Golovi: ${row.goals} | Ugovor: ${this.player.contractYearsLeft} god`);
    });
    this.addLog(`Ukupno golova u karijeri: ${this.player.totalGoals}`);
    this.addLog('-------------------------------\n');
  }

  endCareer() {
    if (this.ended) return;
    this.ended = true;
    this.awaitingTransfer = false;
    this.clearOffers();
    this.addLog('\n=== Kraj karijere ===');
    this.addLog(`Završna starost: ${this.player.age} godina`);
    this.addLog(`Zadnji klub: ${this.player.club ? this.player.club.name : 'bez kluba'}`);
    this.addLog(`Ukupno golova: ${this.player.totalGoals}`);
    this.addLog(`Završni rating: ${this.player.rating.toFixed(1)}`);
  }
}

const careerGame = new CareerGame();
careerGame.initialize();
nextSeasonBtn.addEventListener('click', () => careerGame.simulateSeason());
declineOffersBtn.addEventListener('click', () => careerGame.declineOffers());
