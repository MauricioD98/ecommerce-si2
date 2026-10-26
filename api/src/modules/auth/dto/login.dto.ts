import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsNotEmpty, IsString } from "class-validator";

export class LoginDto{
    @ApiProperty({
        description:'User email address',
        example:'john.doe@example.com',
    })
    @IsEmail()
    @IsNotEmpty()
    email: string;


    @ApiProperty({
        description: 'User password',
        example: 'StrongP@ssw0rd!',
    })
    @IsString()
    @IsNotEmpty()
    password: string;
}