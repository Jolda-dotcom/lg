// football-career-sim.js
// Samostalna simulacija fudbalske karijere napadača golgetera.

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
    this.potential = initialRating + 18 + Math.random() * 6;
    this.club = null;
    this.contractYearsLeft = 3;
    this.totalGoals = 0;
    this.goalsLastSeason = 0;
    this.injurySeasons = 0;
    this.retired = false;
    this.history = [];
  }

  get buildFactor() {
    const heightBonus = Math.max(0, (this.height - 180) * 0.02);
    const weightBonus = Math.max(0, (80 - this.weight) * 0.01);
    return 1 + heightBonus + weightBonus;
  }

  get value() {
    return Math.max(300000, Math.round(this.rating * 110000));
  }

  ageOneYear() {
    this.age += 1;
    if (this.contractYearsLeft > 0) {
      this.contractYearsLeft -= 1;
    }
  }

  train() {
    if (this.injurySeasons > 0) {
      return;
    }

    const before = this.rating;
    let change = 0;
    if (this.age <= 20) {
      change = 3 + Math.random() * 2;
    } else if (this.age <= 24) {
      change = 1.5 + Math.random() * 1.5;
    } else if (this.age <= 28) {
      change = 0.8 + Math.random() * 1.2;
    } else if (this.age <= 32) {
      change = -0.2 + Math.random() * 0.9;
    } else if (this.age <= 36) {
      change = -0.8 + Math.random() * 0.6;
    } else {
      change = -1.4 + Math.random() * 0.4;
    }

    if (this.age > 30) {
      change -= Math.random() * 0.5;
    }

    this.rating = Math.max(50, Math.min(96, this.rating + change));
    if (this.rating > this.potential) {
      this.rating = this.potential;
    }
    return this.rating - before;
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
      const severity = Math.random();
      if (severity < 0.5) {
        this.injurySeasons = 1;
      } else {
        this.injurySeasons = 2;
      }
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

  get clubStrength() {
    return this.offense + this.level * 1.2;
  }

  signPlayer(player, years) {
    if (this.squad.includes(player)) return;
    this.squad.push(player);
    player.club = this;
    player.contractYearsLeft = years;
  }

  sellPlayer(player, fee) {
    const idx = this.squad.indexOf(player);
    if (idx !== -1) {
      this.squad.splice(idx, 1);
      player.club = null;
      this.budget += fee;
    }
  }

  playSeason(player, year) {
    if (player.isInjured) {
      const goals = Math.max(0, Math.round(3 + Math.random() * 3));
      player.goalsLastSeason = goals;
      player.totalGoals += goals;
      return {
        year,
        club: this,
        goals,
        expectedGoals: 0,
        satisfaction: 'Povrijeđen',
        reason: 'povreda',
      };
    }

    const agePenalty = Math.max(0, (player.age - 28) * 0.03);
    const ratingFactor = Math.max(0, (player.rating - 60) * 0.45);
    const supportFactor = this.offense * 0.7;
    const baseGoals = 8 + ratingFactor + supportFactor;
    const randomFactor = Math.random() * 6;
    const goals = Math.round((baseGoals + randomFactor) * player.buildFactor * (1 - agePenalty));

    const expectedGoals = Math.round(10 + this.offense * 1.4 + (player.rating - 60) * 0.3);
    const actualGoals = Math.max(0, Math.min(42, goals));

    player.goalsLastSeason = actualGoals;
    player.totalGoals += actualGoals;

    const satisfaction = this.evaluateSatisfaction(player, actualGoals, expectedGoals);

    return {
      year,
      club: this,
      goals: actualGoals,
      expectedGoals,
      satisfaction,
      reason: 'normalno',
    };
  }

  evaluateSatisfaction(player, goals, expectedGoals) {
    if (goals >= expectedGoals) {
      return 'Zadovoljan';
    }
    if (goals >= expectedGoals * 0.8) {
      return 'Neutralan';
    }
    return 'Nije zadovoljan';
  }
}

class TransferMarket {
  constructor(clubs) {
    this.clubs = clubs;
  }

  generateOffers(player) {
    const offers = [];
    const baseScore = Math.max(0, (player.goalsLastSeason - 8) * 0.1 + (player.rating - 64) * 0.05);
    const contractPressure = player.contractYearsLeft <= 1 ? 0.15 : 0;
    const agePenalty = player.age > 30 ? (player.age - 30) * 0.03 : 0;

    this.clubs.forEach((club) => {
      if (club === player.club) return;
      const levelBonus = (club.level - (player.club ? player.club.level : 1)) * 0.08;
      const interest = Math.min(0.9, Math.max(0, 0.12 + baseScore + levelBonus - agePenalty + contractPressure));
      if (Math.random() < interest) {
        const price = Math.round(player.value * (0.55 + club.level * 0.12 + Math.random() * 0.25));
        const years = player.age <= 30 ? 4 : 2;
        offers.push({ club, price, years, interest: interest.toFixed(2) });
      }
    });

    if (offers.length === 0 && player.goalsLastSeason > 15 && player.rating > 72) {
      const betterClubs = this.clubs.filter((club) => club.level >= 3 && club !== player.club);
      if (betterClubs.length > 0) {
        const chosen = betterClubs[Math.floor(Math.random() * betterClubs.length)];
        offers.push({ club: chosen, price: Math.round(player.value * 1.1), years: 3, interest: '0.95' });
      }
    }

    return offers.sort((a, b) => b.price - a.price);
  }
}

class CareerSimulator {
  constructor() {
    this.player = new Player('Armin', 16, 186, 76, 'Napadač', 66);
    this.clubs = [
      new Club('FK Sarajevo', 'BiH', 1, 18000000, 7.2),
      new Club('HŠK Zrinjski', 'BiH', 1, 12000000, 6.8),
      new Club('GNK Dinamo Zagreb', 'HR', 2, 70000000, 8.3),
      new Club('RB Salzburg', 'AUT', 2, 90000000, 8.5),
      new Club('Borussia Dortmund', 'GER', 3, 220000000, 9.0),
      new Club('PSG', 'FRA', 4, 420000000, 9.4),
      new Club('FC Barcelona', 'ESP', 4, 430000000, 9.5),
    ];
    this.market = new TransferMarket(this.clubs);
    this.currentSeason = 2025;
    this.reportBuffer = [];
    this.yearsSinceLastReport = 0;
    this.maxAge = 42;
    this.initializeCareer();
  }

  initializeCareer() {
    const firstClub = this.clubs[0];
    firstClub.signPlayer(this.player, 3);
    console.log('=== Fudbalska karijera golgetera ===');
    console.log(`Igrač: ${this.player.name}, Godina: ${this.player.age}, Visina: ${this.player.height}cm, Težina: ${this.player.weight}kg, Pozicija: ${this.player.position}`);
    console.log(`Početni klub: ${firstClub.name} (${firstClub.country})`);
    console.log(`Početni rating: ${this.player.rating.toFixed(1)} | Potencijal: ${this.player.potential.toFixed(1)}\n`);
  }

  simulateCareer() {
    while (!this.player.retired) {
      this.playSeason();
      if (this.player.age >= this.maxAge) {
        if (this.player.age >= 41) {
          this.player.retired = true;
          this.printFinalCareer();
          break;
        }
      }
    }
  }

  playSeason() {
    const seasonLabel = `${this.currentSeason}/${this.currentSeason + 1}`;
    const club = this.player.club;
    if (!club) {
      const firstClub = this.clubs[0];
      firstClub.signPlayer(this.player, 2);
    }

    if (this.player.isInjured) {
      console.log(`
Sezona ${seasonLabel} | ${club.name} | ${this.player.age} godina | Povreda sužava sezonu`);
    } else {
      console.log(`
Sezona ${seasonLabel} | Klub: ${club.name} | Godina: ${this.player.age}`);
    }

    const stats = club.playSeason(this.player, this.currentSeason);
    this.player.history.push(stats);
    this.reportBuffer.push(stats);

    console.log(`Golovi: ${stats.goals} | Očekivano: ${stats.expectedGoals || '—'} | Ugovor preostalo: ${this.player.contractYearsLeft} god`);
    console.log(`Status kluba: ${stats.satisfaction}${stats.reason === 'povreda' ? ' (povreda)' : ''}`);

    const offers = this.market.generateOffers(this.player);
    if (offers.length > 0) {
      this.printOffers(offers);
      this.tryAcceptOffer(offers);
    } else {
      console.log('Ponude novih klubova: trenutno nema ozbiljnih ponuda.');
    }

    this.player.checkInjury();
    const delta = this.player.train();
    const trained = delta !== undefined ? Number(delta.toFixed(1)) : 0;
    const trainedText = trained >= 0 ? `+${trained.toFixed(1)}` : trained.toFixed(1);
    console.log(`Trening i napredak: rating ${this.player.rating.toFixed(1)} (${trainedText})`);

    this.player.ageOneYear();
    this.currentSeason += 1;
    this.yearsSinceLastReport += 1;

    if (this.yearsSinceLastReport >= 2) {
      this.printBiannualReport();
      this.yearsSinceLastReport = 0;
      this.reportBuffer = [];
    }

    if (this.player.age > this.maxAge || this.player.rating < 52 && this.player.age > 36) {
      this.player.retired = true;
      this.printFinalCareer();
    }
  }

  printOffers(offers) {
    console.log('Ponude novih klubova:');
    offers.slice(0, 3).forEach((offer, index) => {
      console.log(
        `  ${index + 1}. ${offer.club.name} (${offer.club.country}) | Nivo: ${offer.club.level} | Transfer: ${formatMoney(offer.price)} | ponuda ugovor ${offer.years} god`
      );
    });
  }

  tryAcceptOffer(offers) {
    if (this.player.contractYearsLeft <= 1 && offers.length > 0) {
      this.acceptBestOffer(offers);
      return;
    }

    const currentClub = this.player.club;
    const topOffer = offers[0];
    if (!topOffer) return;
    if (topOffer.club.level > currentClub.level && this.player.goalsLastSeason >= 12) {
      this.acceptBestOffer(offers);
    }
  }

  acceptBestOffer(offers) {
    const offer = offers[0];
    const currentClub = this.player.club;
    if (offer.club.budget >= offer.price) {
      if (currentClub) {
        currentClub.sellPlayer(this.player, offer.price);
      }
      offer.club.signPlayer(this.player, offer.years);
      offer.club.budget -= offer.price;
      console.log(`TRANSFER: ${this.player.name} prešao u ${offer.club.name} za ${formatMoney(offer.price)}. Ugovor: ${offer.years} god.`);
    }
  }

  printBiannualReport() {
    console.log('\n=== Izvještaj nakon 2 godine ===');
    this.reportBuffer.forEach((stats) => {
      console.log(
        `${stats.year}/${stats.year + 1}: ${stats.club.name} | Golovi: ${stats.goals} | Ugovor preostalo: ${this.player.contractYearsLeft} god | ${stats.satisfaction}`
      );
    });
    const club = this.player.club;
    console.log(`Trenutno u klubu: ${club.name} | Ugovor preostalo: ${this.player.contractYearsLeft} god`);
    console.log(`Ukupno golova u karijeri: ${this.player.totalGoals}`);
    console.log('================================\n');
  }

  printFinalCareer() {
    console.log('\n=== Kraj karijere ===');
    console.log(`Igrač: ${this.player.name}`);
    console.log(`Završna starost: ${this.player.age} godina`);
    console.log(`Zadnji klub: ${this.player.club ? this.player.club.name : 'bez kluba'}`);
    console.log(`Ukupno golova: ${this.player.totalGoals}`);
    console.log(`Završni rating: ${this.player.rating.toFixed(1)}`);
    console.log('Sezonski rezultat po godini:');
    this.player.history.forEach((stats) => {
      console.log(`  ${stats.year}/${stats.year + 1}: ${stats.club.name} - ${stats.goals} golova`);
    });
    console.log('========================');
  }
}

new CareerSimulator().simulateCareer();
