import { ArrowLeft } from "lucide-react";

export function Manifesto() {
  return (
    <article className="relative px-4 py-12 sm:px-8 sm:py-20">
      <div className="mx-auto max-w-[1500px]">
        <a
          href="/"
          className="mb-12 inline-flex items-center gap-2 font-mono text-[12px] uppercase text-white/42 underline decoration-white/20 underline-offset-4 transition hover:text-white"
        >
          <ArrowLeft size={14} /> Back to home
        </a>

        <header className="hud-frame border-b border-white/12 pb-12">
          <div className="mb-5 font-mono text-[12px] uppercase text-cyan-200">
            manifesto / full text
          </div>
          <h1 className="max-w-4xl text-[clamp(38px,11.8vw,48px)] font-extrabold uppercase leading-[0.94] text-white [text-shadow:0_0_34px_rgba(103,232,249,0.12)] sm:text-[76px] sm:leading-[0.92] lg:text-[104px]">
            The Crate Manifesto
          </h1>
        </header>

        <div className="mx-auto mt-12 max-w-[820px] border-l border-cyan-200/20 pl-4 text-[15px] leading-[1.85] text-white/65 sm:mt-14 sm:pl-8 sm:text-[16px]">
          <p>
            A while ago, I stopped feeling comfortable using the major streaming
            platforms. At first it was just a vague discomfort, the feeling that
            something no longer fit. Over time, it became painfully clear: the
            treatment of artists, the ruthless extraction logic, and business
            decisions that couldn't be separated from their political and
            cultural consequences. All of it piled up until the question was no
            longer "which service do I use?" but "what kind of system am I
            feeding?"
          </p>
          <br />
          <p className="text-[18px] font-medium leading-[1.7] text-white/85">
            Music has always meant everything to me. Not as background noise,
            not as functional ambience, not as another algorithm-driven playlist
            trying to keep me hooked for five more minutes. Music is discovery,
            context, obsession, memory, identity, and community.
          </p>
          <br />
          <p>
            It became harder and harder to reconcile that deep relationship with
            platforms that turn music into a supply chain optimized for
            attention capture and corporate profit.
          </p>
          <br />
          <p>
            The system isn't broken — it's working exactly as designed. Designed
            to extract value from artists and redistribute it upward. An
            independent musician needs hundreds of thousands of streams to earn
            what a single concert ticket costs. Fractions of a cent per play
            while the platforms hand billions to shareholders. The pro-rata
            model is a legal scam: your listens subsidize major label hits and
            executive bonuses.
          </p>
          <br />
          <p>
            <b>Spotify is the largest extractor.</b> It pays artists less per
            stream than any competitor while spending billions on podcast
            exclusivity, stock buybacks, and military AI contracts. Apple Music
            and Amazon Music are loss leaders designed to sell hardware and
            Prime subscriptions — music is the bait, not the product. YouTube
            Music monetizes your attention and serves ads on independent
            artists' work without asking. These are not music companies. They
            are extraction companies that happen to sell access to music.
          </p>
          <br />
          <p className="text-[20px] font-medium leading-[1.7] text-white/85">
            In a system like this, piracy is not theft. It's self-defense.
          </p>
          <br />
          <p>
            But let's be clear about what that means. This is not a call to stop
            paying artists. It's a call to stop paying middlemen. Pirate the
            catalog that the labels hold hostage — the music that already made
            its money ten times over. Then spend every cent you save on concert
            tickets, Bandcamp purchases, merch tables, and direct support.
            Pirate from the corporation. Pay the artist. The two acts belong
            together.
          </p>
          <br />
          <p>
            The real theft happens every day, in plain sight, with terms of
            service and quarterly earnings reports. It happens when a platform
            pays an artist $0.003 per stream and calls it "democratizing music."
            It happens when algorithms bury the work of independent musicians
            under an endless sea of AI-generated filler and major-label playlist
            placements. It happens when the entire relationship between a
            listener and a musician is mediated by a corporation whose only
            incentive is to keep you scrolling.
          </p>
          <br />
          <p>
            That's why more and more artists are saying <b>enough</b>. Massive
            Attack, King Gizzard & the Lizard Wizard, Godspeed You! Black
            Emperor, and others have pulled their music from Spotify — not just
            over the miserable payouts, but because they refuse to let their
            listeners' money fund a model that destroys culture and invests in
            military AI tech.
          </p>
          <br />
          <p>
            The math is public. An artist with forty thousand monthly listeners
            on Spotify earns roughly a hundred dollars a month from streams. On
            Bandcamp Friday, selling thirty albums at ten dollars each puts two
            hundred and seventy dollars directly in the artist's hands. Same
            audience, thirty times the income. The platforms know this math.
            They're counting on you not doing it.
          </p>
          <br />
          <p>
            This is bigger than music. It's the same logic that turns housing
            into investment vehicles, food delivery into gig exploitation, and
            personal data into surveillance products. The streaming economy is
            not an accident — it's a pattern. Platforms own the pipes, extract
            the value, and leave creators with scraps while calling it
            opportunity. Your listening history is not neutral. It's a
            commodity. Every skip, every repeat, every 3 AM playlist builds a
            profile that is bought and sold. With Crate, that data stays on your
            server. No corporation builds a profile on your taste. No algorithm
            nudges you toward whatever pays the highest royalty. Your attention
            is not the product.
          </p>
          <br />
          <p>
            So yes: download the music. Build your library. Own your files. And
            then take the money you would have given to a streaming platform and
            spend it where it actually matters.
          </p>
          <br />
          <p>
            Buy the concert ticket. Buy the record at the merch table. Buy the
            t-shirt. Send the band a message telling them their album changed
            your week. Show up. That is how you support music. That is how you
            keep music alive. Not by adding another passive stream to a pool
            that pays artists less than minimum wage.
          </p>
          <br />
          <p>
            This is not just a complaint. It is a call to reclaim what belongs
            to us. Music is not content. It is culture. And culture should not
            be rented.
          </p>

          <p>
            This is also not a solo project. It's a bet that small groups of
            people — friends, collectives, local scenes, people who will still
            be self-hosting things in ten years — can build their own
            infrastructure. Run a Crate instance for your community. Host a
            listening party. Share your library with your housemates. The goal
            isn't to replace Spotify with another monolith. It's to make the
            monolith irrelevant, one community server at a time.
          </p>
          <br />
          <p className="text-[18px] font-medium leading-[1.7] text-white/85">
            Own your music. Support your artists. Refuse the middleman. Resist.
          </p>
        </div>
      </div>
    </article>
  );
}
