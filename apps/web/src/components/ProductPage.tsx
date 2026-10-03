import React from "react";
import { Container, Text, Button, Group } from "@mantine/core";
import { Link } from "react-router-dom";
import PublicNavBar from "./PublicNavBar";

const ProductPage: React.FC = () => {
  return (
    <>
      <PublicNavBar />
      <Container
        size="sm"
        style={{ paddingTop: "2rem", paddingBottom: "2rem" }}
      >
        <Text size="h3">Art Collection Management</Text>

        <Text mt="xl">Manage and showcase your art collections with ease.</Text>

        <Group mt="xl">
          <Button component={Link} to="/login" variant="outline">
            Login
          </Button>
        </Group>
      </Container>
    </>
  );
};

export default ProductPage;
