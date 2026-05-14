package com.spotu;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;

@SpringBootApplication
@EnableAsync
public class SpotuApplication {

    public static void main(String[] args) {
        SpringApplication.run(SpotuApplication.class, args);
    }
}
