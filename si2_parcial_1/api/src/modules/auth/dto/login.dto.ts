import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsNotEmpty, IsString } from "class-validator";

export class LoginDto{
    @ApiProperty({
        description:'User email address',
        example:'john.doe@example.com',
    })
    @IsEmail({},{message:'Por favor ingrese un email valido'})
    @IsNotEmpty({message:'El Email es un dato requerido'})
    email: string;


    @ApiProperty({
        description: 'User password',
        example: 'StrongP@ssw0rd!',
    })
    @IsString()
    @IsNotEmpty({message:'La contraseña es un dato requerido'})
    password: string;
}