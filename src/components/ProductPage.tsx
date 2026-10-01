import React from "react";
import {
  Accordion,
  Badge,
  Box,
  Button,
  Container,
  Divider,
  Grid,
  Group,
  Image,
  List,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { Link } from "react-router-dom";
import PublicNavBar from "./PublicNavBar";

// ---------------------------------------------------------------------------
// Waitlist form — Mailchimp embedded form.
//
// Replace the action URL with your Mailchimp embedded form action.
// The standard format is:
//   https://YOUR_USERNAME.list-manage.com/subscribe/post?u=YOUR_U_VALUE&id=YOUR_ID_VALUE
// ---------------------------------------------------------------------------

const MAILCHIMP_ACTION_URL =
  "https://YOUR_USERNAME.list-manage.com/subscribe/post?u=YOUR_U_VALUE&id=YOUR_ID_VALUE";

const WaitlistForm: React.FC = () => (
  <form action={MAILCHIMP_ACTION_URL} method="post" target="_blank">
    <TextInput
      label="Email address"
      placeholder="you@example.com"
      required
      name="EMAIL"
      type="email"
    />
    <Button type="submit" mt="md" fullWidth>
      Join the waitlist
    </Button>
  </form>
);

// ---------------------------------------------------------------------------
// Section components
// ---------------------------------------------------------------------------

const Section: React.FC<{
  children: React.ReactNode;
  id?: string;
}> = ({ children, id }) => (
  <Box py={{ base: "3xl", md: "4xl" }} id={id}>
    <Container size="xl">{children}</Container>
  </Box>
);

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

const Hero: React.FC = () => (
  <Box py={{ base: "4xl", md: "6xl" }}>
    <Container size="xl">
      <Grid>
        <Grid.Col span={8}>
          <Stack gap="lg">
            <Title order={1} size="h1" lh={1.1}>
              Art management for real people.
            </Title>
            <Text size="xl" c="dimmed" maw="600px">
              Arcula keeps the record of every work in a private collection —
              how you acquired it, where it came from, what it is worth, what
              condition it is in — and publishes the ones you choose to show.
            </Text>
            <Text size="lg" fw={500} c="dark.3">
              Show one work to a dealer. Keep the rest of the collection
              private.
            </Text>
            <Group mt="md">
              <Button component="a" href="#waitlist" size="lg">
                Join the waitlist
              </Button>
              <Text size="sm" c="dimmed">
                Arcula is in private beta. Join the list and we'll write when an
                account is ready.
              </Text>
            </Group>
          </Stack>
        </Grid.Col>
        <Grid.Col span={4}>
          <Image src="/public/images/image1.webp" />
        </Grid.Col>
      </Grid>
    </Container>
  </Box>
);

// ---------------------------------------------------------------------------
// The problem
// ---------------------------------------------------------------------------

const Problem: React.FC = () => (
  <Section>
    <Stack gap="md">
      <Text size="lg">
        Every collection has a catalogue. Most of them are a spreadsheet and a
        folder of photographs named after whatever the camera was called that
        day. The acquisition date is in one file, the provenance in an email,
        the condition report in a drawer, and the valuation in a book from four
        years ago.
      </Text>
      <Text size="lg">
        None of that is hard to gather and very hard to keep. What you end up
        with is a record you cannot search, cannot show, and cannot hand to
        anyone — an insurer, an estate, a dealer, or whoever has to take it over
        when you can't.
      </Text>
    </Stack>
  </Section>
);

// ---------------------------------------------------------------------------
// Keep it stupid simple
// ---------------------------------------------------------------------------

const Kiss: React.FC = () => (
  <Section id="simple">
    <Stack gap="lg">
      <Title order={2} size="h2">
        Keep it stupid simple.
      </Title>
      <Text size="lg">
        You own some work. You are not managing a body of work, and you don't
        want software that makes you behave like you are.
      </Text>
      <Divider label="Four things. That's the product." labelPosition="left" />
      <List size="lg" spacing="sm">
        <List.Item>Keep the record of what you own.</List.Item>
        <List.Item>Photograph it.</List.Item>
        <List.Item>Keep the papers with it.</List.Item>
        <List.Item>Publish what you choose.</List.Item>
      </List>
      <Text size="lg" c="dimmed">
        No contacts. No invoicing, no payments, no sales pipeline. No marketing
        emails, no analytics, no tracking. Arcula doesn't do those things.
      </Text>
      <Divider label="What you get" labelPosition="left" />
      <Stack gap="md">
        <Box>
          <Text fw={600}>A link to send people.</Text>
          <Text c="dimmed">
            To a friend, an estate planner, a dealer. You choose which works are
            on it.
          </Text>
        </Box>
        <Box>
          <Text fw={600}>Answers to the questions you actually ask.</Text>
          <Text c="dimmed">
            What did I pay for this. Where is the certificate. What is it
            insured for.
          </Text>
        </Box>
        <Box>
          <Text fw={600}>Maintenance that isn't a project plan.</Text>
          <Text c="dimmed">
            Add the new one, move a photograph, correct a title.
          </Text>
        </Box>
      </Stack>
    </Stack>
  </Section>
);

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

const Catalogue: React.FC = () => (
  <Section id="catalogue">
    <Stack gap="lg">
      <Title order={2} size="h2">
        Fourteen fields. Not fifteen, not eight.
      </Title>
      <Text size="lg" c="dimmed">
        The record, in the fields a collection actually uses.
      </Text>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
        <Paper withBorder p="lg">
          <Text fw={600} mb="sm">
            Acquisition &amp; value
          </Text>
          <List size="sm" spacing="xs">
            <List.Item>Acquisition date</List.Item>
            <List.Item>Acquisition price</List.Item>
            <List.Item>Place of origin</List.Item>
            <List.Item>Current value</List.Item>
          </List>
        </Paper>
        <Paper withBorder p="lg">
          <Text fw={600} mb="sm">
            Provenance &amp; condition
          </Text>
          <List size="sm" spacing="xs">
            <List.Item>Provenance</List.Item>
            <List.Item>Condition</List.Item>
            <List.Item>Notes</List.Item>
          </List>
        </Paper>
        <Paper withBorder p="lg">
          <Text fw={600} mb="sm">
            The work
          </Text>
          <List size="sm" spacing="xs">
            <List.Item>Title</List.Item>
            <List.Item>Artist</List.Item>
            <List.Item>Series</List.Item>
            <List.Item>Date of creation</List.Item>
            <List.Item>Medium</List.Item>
            <List.Item>Dimensions</List.Item>
            <List.Item>Editions</List.Item>
          </List>
        </Paper>
        <Paper withBorder p="lg">
          <Text fw={600} mb="sm">
            What you can do with it
          </Text>
          <List size="sm" spacing="xs">
            <List.Item>Sortable table</List.Item>
            <List.Item>Batch actions</List.Item>
            <List.Item>Nothing is ever deleted</List.Item>
          </List>
        </Paper>
      </SimpleGrid>
    </Stack>
  </Section>
);

// ---------------------------------------------------------------------------
// The images
// ---------------------------------------------------------------------------

const Images: React.FC = () => (
  <Section id="images">
    <Stack gap="lg">
      <Title order={2} size="h2">
        One upload. Every size a page needs.
      </Title>
      <Text size="lg">
        Five sizes are made the moment you drop the file — up to 2400px for
        full-screen viewing, square crops for thumbnails, and the original
        untouched. Drag to reorder; the first photograph is the one everything
        else in the app uses.
      </Text>
      <Text size="lg" c="dimmed">
        The form stays usable while ten photographs are processed.
      </Text>
    </Stack>
  </Section>
);

// ---------------------------------------------------------------------------
// The document drawer
// ---------------------------------------------------------------------------

const Documents: React.FC = () => (
  <Section id="documents">
    <Stack gap="lg">
      <Title order={2} size="h2">
        The papers stay private.
      </Title>
      <Text size="lg">
        Condition reports, certificates, receipts, appraisals, provenance notes.
        PDFs and images up to 25 MB, attached to the work they belong to.
      </Text>
      <Text size="lg">
        They are never public — and not because the interface chooses to hide
        them. The server refuses to serve a document to anyone but its owner. A
        share link cannot leak a condition report.
      </Text>
    </Stack>
  </Section>
);

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

const Publishing: React.FC = () => (
  <Section id="publishing">
    <Stack gap="lg">
      <Title order={2} size="h2">
        The archive and the exhibition are the same data.
      </Title>
      <Box>
        <Text fw={600} size="lg" mb="xs">
          What's public.
        </Text>
        <Text size="lg">
          Every work carries its own public switch, independent of the
          collection's. Mark one work public and it appears at your Arcula
          address; leave the rest alone and nobody sees them.
        </Text>
      </Box>
      <Box>
        <Text fw={600} size="lg" mb="xs">
          How it looks.
        </Text>
        <Text size="lg">
          A collection chooses how it presents itself, and changing that never
          touches a record. Arcula ships one presentation: full-screen, one work
          per screen, with the title and artist beneath it. More are coming —
          each as simple as the first.
        </Text>
      </Box>
    </Stack>
  </Section>
);

// ---------------------------------------------------------------------------
// Privacy and the rules
// ---------------------------------------------------------------------------

const Privacy: React.FC = () => (
  <Section id="privacy">
    <Stack gap="lg">
      <Title order={2} size="h2">
        What we hide is the easy part.
      </Title>
      <Text size="lg">
        Your collection isn't private because Arcula decided not to show it.
        It's private because the server refuses to send it. Someone who isn't
        signed in asks for your collection by name and gets nothing back — the
        name doesn't leave the server either. Dates are stamped by the server
        rather than by the form, so a record can't claim a year it wasn't given.
        And the rules that do this have to pass their tests before they can go
        anywhere near a collection.
      </Text>
    </Stack>
  </Section>
);

// ---------------------------------------------------------------------------
// Getting your data in
// ---------------------------------------------------------------------------

const CsvImport: React.FC = () => (
  <Section id="import">
    <Stack gap="lg">
      <Title order={2} size="h2">
        Start from what you already have.
      </Title>
      <Text size="lg">
        A CSV of the list you already keep. Arcula matches your columns,
        converts what it can — a bare year, a date written the other way round —
        and flags every conversion so you can check it. You edit rows in the
        table before anything is written. The file is read in your browser and
        never uploaded.
      </Text>
    </Stack>
  </Section>
);

// ---------------------------------------------------------------------------
// Roadmap
// ---------------------------------------------------------------------------

const Roadmap: React.FC = () => (
  <Section id="roadmap">
    <Stack gap="lg">
      <Title order={2} size="h2">
        What's here now, what's next.
      </Title>
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="lg">
        <Paper withBorder p="lg">
          <Badge color="green" variant="filled" mb="md" size="lg">
            Available today
          </Badge>
          <List size="sm" spacing="xs">
            <List.Item>The catalogue and its fourteen fields</List.Item>
            <List.Item>Photographs, five sizes, reorderable</List.Item>
            <List.Item>Private documents</List.Item>
            <List.Item>Publishing, per work</List.Item>
            <List.Item>Server-enforced privacy</List.Item>
            <List.Item>CSV import</List.Item>
            <List.Item>Nothing is ever deleted</List.Item>
          </List>
        </Paper>
        <Paper withBorder p="lg">
          <Badge color="blue" variant="filled" mb="md" size="lg">
            In beta
          </Badge>
          <List size="sm" spacing="xs">
            <List.Item>Self-service accounts and profiles</List.Item>
            <List.Item>One collection per account</List.Item>
            <List.Item>
              A place for each work — <em>which room, which wall</em>
            </List.Item>
            <List.Item>First-party support for small galleries</List.Item>
          </List>
        </Paper>
        <Paper withBorder p="lg">
          <Badge color="gray" variant="filled" mb="md" size="lg">
            Planned
          </Badge>
          <List size="sm" spacing="xs">
            <List.Item>More than one collection per account</List.Item>
            <List.Item>Search and filtering</List.Item>
            <List.Item>Filter and sort by location</List.Item>
            <List.Item>Export to CSV and PDF</List.Item>
            <List.Item>Further presentation styles</List.Item>
            <List.Item>Trash, restore, and permanent deletion</List.Item>
            <List.Item>An API</List.Item>
          </List>
        </Paper>
      </SimpleGrid>
    </Stack>
  </Section>
);

// ---------------------------------------------------------------------------
// FAQ
// ---------------------------------------------------------------------------

const Faq: React.FC = () => (
  <Section id="faq">
    <Stack gap="lg">
      <Title order={2} size="h2">
        Questions.
      </Title>
      <Accordion variant="separated" radius="sm">
        <Accordion.Item value="who">
          <Accordion.Control>Who is Arcula for?</Accordion.Control>
          <Accordion.Panel>
            <Text>
              Private collectors and owners. People who own work and want a
              record of it — not a gallery management system.
            </Text>
          </Accordion.Panel>
        </Accordion.Item>
        <Accordion.Item value="private">
          <Accordion.Control>Is my collection private?</Accordion.Control>
          <Accordion.Panel>
            <Text>
              Yes. Your collection is private by default. Someone who isn't
              signed in asks for your collection by name and gets nothing back —
              the name doesn't leave the server either.
            </Text>
          </Accordion.Panel>
        </Accordion.Item>
        <Accordion.Item value="one-work">
          <Accordion.Control>
            Can I show one work and keep the rest private?
          </Accordion.Control>
          <Accordion.Panel>
            <Text>
              Yes. Every work carries its own public switch, independent of the
              collection's. Mark one work public and it appears at your Arcula
              address; leave the rest alone and nobody sees them.
            </Text>
          </Accordion.Panel>
        </Accordion.Item>
        <Accordion.Item value="data">
          <Accordion.Control>
            What happens to my data if I leave?
          </Accordion.Control>
          <Accordion.Panel>
            <Text>
              Your data is yours. It lives in your own Firebase project. Export
              it, delete it, or take it with you — it was never ours.
            </Text>
          </Accordion.Panel>
        </Accordion.Item>
        <Accordion.Item value="galleries">
          <Accordion.Control>Is Arcula for galleries?</Accordion.Control>
          <Accordion.Panel>
            <Text>
              Not yet. Arcula is built for private collectors and owners. If
              you're a gallery, the missing pieces are contacts and sales,
              invoicing, payments, and offers. Those are on the roadmap.
            </Text>
          </Accordion.Panel>
        </Accordion.Item>
        <Accordion.Item value="try">
          <Accordion.Control>Can I try it?</Accordion.Control>
          <Accordion.Panel>
            <Text>
              Arcula is in private beta. Join the waitlist below and we'll write
              when an account is ready.
            </Text>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  </Section>
);

// ---------------------------------------------------------------------------
// Final CTA + Footer
// ---------------------------------------------------------------------------

const FinalCta: React.FC = () => (
  <Box py={{ base: "4xl", md: "6xl" }} id="waitlist">
    <Container size="sm">
      <Stack gap="lg" align="center">
        <Title order={2} size="h2" ta="center">
          Join the waitlist.
        </Title>
        <Text size="lg" c="dimmed" ta="center" maw="500px">
          Arcula is in private beta. Leave your email and we'll write when an
          account is ready.
        </Text>
        <Box w="100%" maw="400px">
          <WaitlistForm />
        </Box>
      </Stack>
    </Container>
  </Box>
);

const Footer: React.FC = () => (
  <Box
    py="xl"
    style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
  >
    <Container size="md">
      <Group justify="space-between" align="flex-start">
        <Stack gap="xs">
          <Text fw={600} size="lg">
            Arcula
          </Text>
          <Text size="sm" c="dimmed">
            Art management for real people.
          </Text>
        </Stack>
        <Group gap="md">
          <Text
            size="sm"
            component={Link}
            to="/login"
            c="dimmed"
            style={{ textDecoration: "none" }}
          >
            Login
          </Text>
          <Text
            size="sm"
            component={Link}
            to="/#faq"
            c="dimmed"
            style={{ textDecoration: "none" }}
          >
            FAQ
          </Text>
          <Text
            size="sm"
            component="a"
            href="mailto:hello@arcula.art"
            c="dimmed"
            style={{ textDecoration: "none" }}
          >
            Contact
          </Text>
        </Group>
      </Group>
    </Container>
  </Box>
);

// ---------------------------------------------------------------------------
// ProductPage — the full page
// ---------------------------------------------------------------------------

const ProductPage: React.FC = () => {
  return (
    <>
      <PublicNavBar />
      <Hero />
      <Problem />
      <Kiss />
      <Catalogue />
      <Images />
      <Documents />
      <Publishing />
      <Privacy />
      <CsvImport />
      <Roadmap />
      <Faq />
      <FinalCta />
      <Footer />
    </>
  );
};

export default ProductPage;
